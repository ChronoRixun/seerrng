import {
  IssueStatus,
  IssueType,
  MAX_ISSUE_MESSAGE_LENGTH,
} from '@server/constants/issue';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import IssueComment from '@server/entity/IssueComment';
import Media from '@server/entity/Media';
import type { IssueResultsResponse } from '@server/interfaces/api/issueInterfaces';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { filterEntityResponse } from '@server/utils/entityResponse';
import {
  parseOptionalPositiveInt,
  parsePageParams,
} from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  parseBoundedString,
  parseOptionalAllowedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router } from 'express';

const issueRoutes = Router();
const MAX_ISSUE_ROUTE_ID = 1_000_000_000;
const issueSortFields = ['modified'] as const;
const issueStatusFilters = ['open', 'resolved'] as const;

const parseIssueStatusAction = (status: unknown): IssueStatus | undefined => {
  switch (status) {
    case 'resolved':
      return IssueStatus.RESOLVED;
    case 'open':
      return IssueStatus.OPEN;
    default:
      return undefined;
  }
};

const parseIssueBodyId = (value: unknown, fieldName: string) => {
  const parsed = parseOptionalNonNegativeInteger(value, MAX_ISSUE_ROUTE_ID);
  return parsed && parsed > 0
    ? { value: parsed }
    : { error: `${fieldName} must be a valid ID.` };
};

const parseIssueBodyOptionalIndex = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === '') {
    return { value: 0 };
  }

  const parsed = parseOptionalNonNegativeInteger(value, MAX_ISSUE_ROUTE_ID);
  return parsed === undefined
    ? { error: `${fieldName} must be a non-negative integer.` }
    : { value: parsed };
};

const parseIssueBodyType = (value: unknown) => {
  const parsed = parseOptionalNonNegativeInteger(value, IssueType.OTHER);
  return parsed && Object.values(IssueType).includes(parsed)
    ? { value: parsed as IssueType }
    : { error: 'Issue type must be valid.' };
};

issueRoutes.get<
  Record<string, string>,
  IssueResultsResponse | { status: number; message: string }
>(
  '/',
  isAuthenticated(
    [
      Permission.MANAGE_ISSUES,
      Permission.VIEW_ISSUES,
      Permission.CREATE_ISSUES,
    ],
    { type: 'or' }
  ),
  async (req, res, next) => {
    const { pageSize, skip } = parsePageParams(req.query, {
      take: 10,
      maxTake: 100,
    });
    const createdBy = parseOptionalPositiveInt(req.query.createdBy) ?? null;
    const parsedSort = parseOptionalAllowedString(req.query.sort, {
      fieldName: 'Sort',
      allowedValues: issueSortFields,
      maxLength: 32,
    });
    if ('error' in parsedSort) {
      return next({ status: 400, message: parsedSort.error });
    }

    const parsedFilter = parseOptionalAllowedString(req.query.filter, {
      fieldName: 'Filter',
      allowedValues: issueStatusFilters,
      maxLength: 32,
    });
    if ('error' in parsedFilter) {
      return next({ status: 400, message: parsedFilter.error });
    }

    let sortFilter: string;

    switch (parsedSort.value) {
      case 'modified':
        sortFilter = 'issue.updatedAt';
        break;
      default:
        sortFilter = 'issue.createdAt';
    }

    let statusFilter: IssueStatus[];

    switch (parsedFilter.value) {
      case 'open':
        statusFilter = [IssueStatus.OPEN];
        break;
      case 'resolved':
        statusFilter = [IssueStatus.RESOLVED];
        break;
      default:
        statusFilter = [IssueStatus.OPEN, IssueStatus.RESOLVED];
    }

    let query = getRepository(Issue)
      .createQueryBuilder('issue')
      .leftJoinAndSelect('issue.createdBy', 'createdBy')
      .leftJoinAndSelect('issue.media', 'media')
      .leftJoinAndSelect('media.identifiers', 'identifiers')
      .leftJoinAndSelect('issue.modifiedBy', 'modifiedBy')
      .leftJoinAndSelect('issue.comments', 'comments')
      .where('issue.status IN (:...issueStatus)', {
        issueStatus: statusFilter,
      });

    if (
      !req.user?.hasPermission(
        [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
        { type: 'or' }
      )
    ) {
      if (createdBy && createdBy !== req.user?.id) {
        return next({
          status: 403,
          message:
            'You do not have permission to view issues reported by other users',
        });
      }
      query = query.andWhere('createdBy.id = :id', { id: req.user?.id });
    } else if (createdBy) {
      query = query.andWhere('createdBy.id = :id', { id: createdBy });
    }

    const [issues, issueCount] = await query
      .orderBy(sortFilter, 'DESC')
      .take(pageSize)
      .skip(skip)
      .getManyAndCount();

    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(issueCount / pageSize),
        pageSize,
        results: issueCount,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: filterEntityResponse(issues),
    });
  }
);

issueRoutes.post<
  Record<string, string>,
  Issue,
  {
    message: string;
    mediaId: number;
    issueType: number;
    problemSeason: number;
    problemEpisode: number;
  }
>(
  '/',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    // Satisfy typescript here. User is set, we assure you!
    if (!req.user) {
      return next({ status: 500, message: 'User missing from request.' });
    }

    const issueRepository = getRepository(Issue);
    const mediaRepository = getRepository(Media);
    const parsedMessage = parseBoundedString(req.body.message, {
      fieldName: 'Issue message',
      maxLength: MAX_ISSUE_MESSAGE_LENGTH,
    });

    if ('error' in parsedMessage) {
      return next({ status: 400, message: parsedMessage.error });
    }
    const mediaId = parseIssueBodyId(req.body.mediaId, 'Media ID');
    if ('error' in mediaId) {
      return next({ status: 400, message: mediaId.error });
    }
    const issueType = parseIssueBodyType(req.body.issueType);
    if ('error' in issueType) {
      return next({ status: 400, message: issueType.error });
    }
    const problemSeason = parseIssueBodyOptionalIndex(
      req.body.problemSeason,
      'Problem season'
    );
    if ('error' in problemSeason) {
      return next({ status: 400, message: problemSeason.error });
    }
    const problemEpisode = parseIssueBodyOptionalIndex(
      req.body.problemEpisode,
      'Problem episode'
    );
    if ('error' in problemEpisode) {
      return next({ status: 400, message: problemEpisode.error });
    }

    const media = await mediaRepository.findOne({
      where: { id: mediaId.value },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    const issue = new Issue({
      createdBy: req.user,
      issueType: issueType.value,
      problemSeason: problemSeason.value,
      problemEpisode: problemEpisode.value,
      media,
      comments: [
        new IssueComment({
          user: req.user,
          message: parsedMessage.value,
        }),
      ],
    });

    const newIssue = await issueRepository.save(issue);

    return res.status(200).json(filterEntityResponse(newIssue));
  }
);

issueRoutes.get(
  '/count',
  isAuthenticated(
    [
      Permission.MANAGE_ISSUES,
      Permission.VIEW_ISSUES,
      Permission.CREATE_ISSUES,
    ],
    { type: 'or' }
  ),
  async (req, res, next) => {
    const issueRepository = getRepository(Issue);

    try {
      const query = issueRepository.createQueryBuilder('issue');

      const totalCount = await query.getCount();

      const videoCount = await query
        .where('issue.issueType = :issueType', {
          issueType: IssueType.VIDEO,
        })
        .getCount();

      const audioCount = await query
        .where('issue.issueType = :issueType', {
          issueType: IssueType.AUDIO,
        })
        .getCount();

      const subtitlesCount = await query
        .where('issue.issueType = :issueType', {
          issueType: IssueType.SUBTITLES,
        })
        .getCount();

      const othersCount = await query
        .where('issue.issueType = :issueType', {
          issueType: IssueType.OTHER,
        })
        .getCount();

      const openCount = await query
        .where('issue.status = :issueStatus', {
          issueStatus: IssueStatus.OPEN,
        })
        .getCount();

      const closedCount = await query
        .where('issue.status = :issueStatus', {
          issueStatus: IssueStatus.RESOLVED,
        })
        .getCount();

      return res.status(200).json({
        total: totalCount,
        video: videoCount,
        audio: audioCount,
        subtitles: subtitlesCount,
        others: othersCount,
        open: openCount,
        closed: closedCount,
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving issue counts.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Unable to retrieve issue counts.' });
    }
  }
);

issueRoutes.get<{ issueId: string }>(
  '/:issueId',
  isAuthenticated(
    [
      Permission.MANAGE_ISSUES,
      Permission.VIEW_ISSUES,
      Permission.CREATE_ISSUES,
    ],
    { type: 'or' }
  ),
  async (req, res, next) => {
    const issueRepository = getRepository(Issue);
    const issueId = parsePositiveRouteId(req.params.issueId);
    if (!issueId) {
      return next({ status: 404, message: 'Issue not found.' });
    }
    // Satisfy typescript here. User is set, we assure you!
    if (!req.user) {
      return next({ status: 500, message: 'User missing from request.' });
    }

    try {
      const issue = await issueRepository
        .createQueryBuilder('issue')
        .leftJoinAndSelect('issue.comments', 'comments')
        .leftJoinAndSelect('issue.createdBy', 'createdBy')
        .leftJoinAndSelect('comments.user', 'user')
        .leftJoinAndSelect('issue.media', 'media')
        .leftJoinAndSelect('media.identifiers', 'identifiers')
        .where('issue.id = :issueId', { issueId })
        .getOneOrFail();

      if (
        issue.createdBy.id !== req.user.id &&
        !req.user.hasPermission(
          [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this issue.',
        });
      }

      return res.status(200).json(filterEntityResponse(issue));
    } catch (e) {
      logger.debug('Failed to retrieve issue.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Issue not found.' });
    }
  }
);

issueRoutes.post<{ issueId: string }, Issue, { message: string }>(
  '/:issueId/comment',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    const issueRepository = getRepository(Issue);
    const issueId = parsePositiveRouteId(req.params.issueId);
    if (!issueId) {
      return next({ status: 404, message: 'Issue not found.' });
    }

    const parsedMessage = parseBoundedString(req.body.message, {
      fieldName: 'Comment message',
      maxLength: MAX_ISSUE_MESSAGE_LENGTH,
    });

    if ('error' in parsedMessage) {
      return next({ status: 400, message: parsedMessage.error });
    }

    // Satisfy typescript here. User is set, we assure you!
    if (!req.user) {
      return next({ status: 500, message: 'User missing from request.' });
    }

    try {
      const issue = await issueRepository.findOneOrFail({
        where: { id: issueId },
      });

      if (
        issue.createdBy.id !== req.user.id &&
        !req.user.hasPermission(Permission.MANAGE_ISSUES)
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to comment on this issue.',
        });
      }

      const comment = new IssueComment({
        message: parsedMessage.value,
        user: req.user,
      });

      issue.comments = [...issue.comments, comment];
      issue.updatedAt = new Date();
      await issueRepository.save(issue);

      return res.status(200).json(filterEntityResponse(issue));
    } catch (e) {
      logger.debug('Something went wrong creating an issue comment.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Issue not found.' });
    }
  }
);

issueRoutes.post<{ issueId: string; status: string }, Issue>(
  '/:issueId/:status',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    const issueRepository = getRepository(Issue);
    const issueId = parsePositiveRouteId(req.params.issueId);
    if (!issueId) {
      return next({ status: 404, message: 'Issue not found.' });
    }
    const newStatus = parseIssueStatusAction(req.params.status);
    if (!newStatus) {
      return next({
        status: 400,
        message: 'You must provide a valid status',
      });
    }

    // Satisfy typescript here. User is set, we assure you!
    if (!req.user) {
      return next({ status: 500, message: 'User missing from request.' });
    }

    try {
      const issue = await issueRepository.findOneOrFail({
        where: { id: issueId },
      });

      if (
        !req.user?.hasPermission(Permission.MANAGE_ISSUES) &&
        issue.createdBy.id !== req.user?.id
      ) {
        return next({
          status: 401,
          message: 'You do not have permission to modify this issue.',
        });
      }

      issue.status = newStatus;
      issue.modifiedBy = req.user;

      await issueRepository.save(issue);

      return res.status(200).json(filterEntityResponse(issue));
    } catch (e) {
      logger.debug('Something went wrong creating an issue comment.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Issue not found.' });
    }
  }
);

issueRoutes.delete(
  '/:issueId',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    const issueRepository = getRepository(Issue);
    const issueId = parsePositiveRouteId(req.params.issueId);
    if (!issueId) {
      return next({ status: 404, message: 'Issue not found.' });
    }

    try {
      const issue = await issueRepository.findOneOrFail({
        where: { id: issueId },
        relations: { createdBy: true },
      });

      if (
        !req.user?.hasPermission(Permission.MANAGE_ISSUES) &&
        (issue.createdBy.id !== req.user?.id || issue.comments.length > 1)
      ) {
        return next({
          status: 401,
          message: 'You do not have permission to delete this issue.',
        });
      }

      await issueRepository.remove(issue);

      return res.status(204).send();
    } catch (e) {
      logger.error('Something went wrong deleting an issue.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 404, message: 'Issue not found.' });
    }
  }
);

export default issueRoutes;
