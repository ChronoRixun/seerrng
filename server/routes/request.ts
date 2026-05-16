import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
  NoSeasonsAvailableError,
  QuotaRestrictedError,
  RequestPermissionError,
  ServiceConfigurationError,
} from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import type {
  BulkMediaRequestBody,
  BulkMediaRequestResponse,
  MediaRequestBody,
  RequestResultsResponse,
} from '@server/interfaces/api/requestInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const requestRoutes = Router();

const validateExternalServiceConfiguration = (
  requestType: MediaType,
  serverId?: number | null,
  bookFormat?: 'ebook' | 'audiobook' | 'both' | null
) => {
  const settings = getSettings();

  if (requestType === MediaType.MUSIC) {
    if (serverId === undefined || serverId === null) {
      if (!settings.lidarr.some((lidarr) => lidarr.isDefault)) {
        throw new ServiceConfigurationError(
          'No default Lidarr server is configured for music requests.'
        );
      }

      return;
    }

    if (!settings.lidarr.some((lidarr) => lidarr.id === serverId)) {
      throw new ServiceConfigurationError(
        'The selected Lidarr server no longer exists.'
      );
    }
  }

  if (requestType === MediaType.BOOK) {
    const requestedFormat = bookFormat ?? 'ebook';

    if (serverId === undefined || serverId === null) {
      const hasDefaultEbook = settings.readarr.some(
        (readarr) =>
          readarr.isDefault && (readarr.serviceType ?? 'ebook') === 'ebook'
      );
      const hasDefaultAudiobook = settings.readarr.some(
        (readarr) => readarr.isDefault && readarr.serviceType === 'audiobook'
      );

      if (requestedFormat === 'both') {
        if (!hasDefaultEbook || !hasDefaultAudiobook) {
          throw new ServiceConfigurationError(
            'Both-format book requests require default ebook and audiobook Bookshelf services.'
          );
        }

        return;
      }

      if (
        (requestedFormat === 'ebook' && !hasDefaultEbook) ||
        (requestedFormat === 'audiobook' && !hasDefaultAudiobook)
      ) {
        throw new ServiceConfigurationError(
          `No default ${requestedFormat} Bookshelf server is configured for book requests.`
        );
      }

      return;
    }

    const selectedReadarr = settings.readarr.find(
      (readarr) => readarr.id === serverId
    );

    if (!selectedReadarr) {
      throw new ServiceConfigurationError(
        'The selected Bookshelf server no longer exists.'
      );
    }

    if (requestedFormat === 'both') {
      throw new ServiceConfigurationError(
        'Both-format book requests must use separate default ebook and audiobook Bookshelf services.'
      );
    }

    const selectedReadarrServiceType = selectedReadarr.serviceType ?? 'ebook';

    if (selectedReadarrServiceType !== requestedFormat) {
      throw new ServiceConfigurationError(
        `The selected Bookshelf server is configured for ${selectedReadarrServiceType} requests, not ${requestedFormat} requests.`
      );
    }
  }
};

const hasBookFormat = (
  media: Media,
  format: 'ebook' | 'audiobook'
): boolean => {
  if (format === 'audiobook') {
    return (
      media.audiobookExternalServiceId !== null &&
      media.audiobookExternalServiceId !== undefined
    );
  }

  return (
    media.externalServiceId !== null && media.externalServiceId !== undefined
  );
};

const isRequestAvailable = (mediaRequest: MediaRequest): boolean => {
  if (!mediaRequest.media) {
    return false;
  }

  if (mediaRequest.type === MediaType.BOOK) {
    const bookFormat = mediaRequest.bookFormat ?? 'ebook';

    if (bookFormat === 'both') {
      return (
        hasBookFormat(mediaRequest.media, 'ebook') &&
        hasBookFormat(mediaRequest.media, 'audiobook')
      );
    }

    return hasBookFormat(mediaRequest.media, bookFormat);
  }

  if (mediaRequest.is4k) {
    return mediaRequest.media.status4k === MediaStatus.AVAILABLE;
  }

  return mediaRequest.media.status === MediaStatus.AVAILABLE;
};

const getBulkCoveredReason = async (
  mediaType: MediaType.MUSIC | MediaType.BOOK,
  mediaId: string,
  format?: 'ebook' | 'audiobook' | 'both'
): Promise<string | undefined> => {
  if (mediaType === MediaType.MUSIC) {
    const media = await getRepository(Media).findOne({
      where: { mbId: mediaId, mediaType: MediaType.MUSIC },
    });

    if (media?.status === MediaStatus.BLOCKLISTED) {
      return 'This album is blocklisted.';
    }

    if (
      media?.status === MediaStatus.AVAILABLE ||
      media?.status === MediaStatus.PROCESSING
    ) {
      return 'This album is already available or processing.';
    }

    return undefined;
  }

  const normalizedOpenLibraryId = mediaId.replace(/^\/?works\//, '');
  const identifier = await getRepository(MediaIdentifier).findOne({
    where: {
      provider: MediaIdentifierProvider.OPENLIBRARY,
      value: normalizedOpenLibraryId,
    },
    relations: { media: true },
  });
  const media = identifier?.media;

  if (!media || media.mediaType !== MediaType.BOOK) {
    return undefined;
  }

  if (media.status === MediaStatus.BLOCKLISTED) {
    return 'This book is blocklisted.';
  }

  const requestedFormat = format ?? 'ebook';
  const ebookAvailable = hasBookFormat(media, 'ebook');
  const audiobookAvailable = hasBookFormat(media, 'audiobook');

  if (requestedFormat === 'ebook' && ebookAvailable) {
    return 'This ebook is already available.';
  }

  if (requestedFormat === 'audiobook' && audiobookAvailable) {
    return 'This audiobook is already available.';
  }

  if (requestedFormat === 'both' && (ebookAvailable || audiobookAvailable)) {
    return 'One or more requested book formats are already available.';
  }

  return undefined;
};

requestRoutes.get<Record<string, unknown>, RequestResultsResponse>(
  '/',
  async (req, res, next) => {
    try {
      const pageSize = req.query.take ? Number(req.query.take) : 10;
      const skip = req.query.skip ? Number(req.query.skip) : 0;
      const requestedBy = req.query.requestedBy
        ? Number(req.query.requestedBy)
        : null;
      const mediaType = (req.query.mediaType as MediaType | 'all') || 'all';

      let statusFilter: MediaRequestStatus[];

      switch (req.query.filter) {
        case 'approved':
        case 'processing':
          statusFilter = [MediaRequestStatus.APPROVED];
          break;
        case 'pending':
          statusFilter = [MediaRequestStatus.PENDING];
          break;
        case 'unavailable':
          statusFilter = [
            MediaRequestStatus.PENDING,
            MediaRequestStatus.APPROVED,
          ];
          break;
        case 'failed':
          statusFilter = [MediaRequestStatus.FAILED];
          break;
        case 'completed':
        case 'available':
        case 'deleted':
          statusFilter = [MediaRequestStatus.COMPLETED];
          break;
        default:
          statusFilter = [
            MediaRequestStatus.PENDING,
            MediaRequestStatus.APPROVED,
            MediaRequestStatus.DECLINED,
            MediaRequestStatus.FAILED,
            MediaRequestStatus.COMPLETED,
          ];
      }

      let mediaStatusFilter: MediaStatus[];

      switch (req.query.filter) {
        case 'available':
          mediaStatusFilter = [MediaStatus.AVAILABLE];
          break;
        case 'processing':
        case 'unavailable':
          mediaStatusFilter = [
            MediaStatus.UNKNOWN,
            MediaStatus.PENDING,
            MediaStatus.PROCESSING,
            MediaStatus.PARTIALLY_AVAILABLE,
          ];
          break;
        case 'deleted':
          mediaStatusFilter = [MediaStatus.DELETED];
          break;
        default:
          mediaStatusFilter = [
            MediaStatus.UNKNOWN,
            MediaStatus.PENDING,
            MediaStatus.PROCESSING,
            MediaStatus.PARTIALLY_AVAILABLE,
            MediaStatus.AVAILABLE,
            MediaStatus.DELETED,
          ];
      }

      let sortFilter: string;
      let sortDirection: 'ASC' | 'DESC';

      switch (req.query.sort) {
        case 'modified':
          sortFilter = 'request.updatedAt';
          break;
        default:
          sortFilter = 'request.id';
      }

      switch (req.query.sortDirection) {
        case 'asc':
          sortDirection = 'ASC';
          break;
        default:
          sortDirection = 'DESC';
      }

      let query = getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.seasons', 'seasons')
        .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
        .leftJoinAndSelect('request.requestedBy', 'requestedBy')
        .leftJoinAndSelect('media.identifiers', 'identifiers')
        .where('request.status IN (:...requestStatus)', {
          requestStatus: statusFilter,
        })
        .andWhere(
          '((request.is4k = false AND media.status IN (:...mediaStatus)) OR (request.is4k = true AND media.status4k IN (:...mediaStatus)))',
          {
            mediaStatus: mediaStatusFilter,
          }
        );

      if (
        !req.user?.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        if (requestedBy && requestedBy !== req.user?.id) {
          return next({
            status: 403,
            message: "You do not have permission to view this user's requests.",
          });
        }

        query = query.andWhere('requestedBy.id = :id', {
          id: req.user?.id,
        });
      } else if (requestedBy) {
        query = query.andWhere('requestedBy.id = :id', {
          id: requestedBy,
        });
      }

      switch (mediaType) {
        case 'all':
          break;
        case 'movie':
          query = query.andWhere('request.type = :type', {
            type: MediaType.MOVIE,
          });
          break;
        case 'tv':
          query = query.andWhere('request.type = :type', {
            type: MediaType.TV,
          });
          break;
        case 'music':
          query = query.andWhere('request.type = :type', {
            type: MediaType.MUSIC,
          });
          break;
        case 'book':
          query = query.andWhere('request.type = :type', {
            type: MediaType.BOOK,
          });
          break;
      }

      const [requests, requestCount] = await query
        .orderBy(sortFilter, sortDirection)
        .take(pageSize)
        .skip(skip)
        .getManyAndCount();

      const settings = getSettings();

      // get all quality profiles for every configured sonarr server
      const sonarrServers = await Promise.all(
        settings.sonarr.map(async (sonarrSetting) => {
          const sonarr = new SonarrAPI({
            apiKey: sonarrSetting.apiKey,
            url: SonarrAPI.buildUrl(sonarrSetting, '/api/v3'),
          });

          return {
            id: sonarrSetting.id,
            profiles: await sonarr.getProfiles().catch(() => undefined),
          };
        })
      );

      // get all quality profiles for every configured radarr server
      const radarrServers = await Promise.all(
        settings.radarr.map(async (radarrSetting) => {
          const radarr = new RadarrAPI({
            apiKey: radarrSetting.apiKey,
            url: RadarrAPI.buildUrl(radarrSetting, '/api/v3'),
          });

          return {
            id: radarrSetting.id,
            profiles: await radarr.getProfiles().catch(() => undefined),
          };
        })
      );

      const lidarrServers = await Promise.all(
        settings.lidarr.map(async (lidarrSetting) => {
          const lidarr = new LidarrAPI({
            apiKey: lidarrSetting.apiKey,
            url: LidarrAPI.buildUrl(lidarrSetting, '/api/v1'),
          });

          return {
            id: lidarrSetting.id,
            profiles: await lidarr.getProfiles().catch(() => undefined),
          };
        })
      );

      const readarrServers = await Promise.all(
        settings.readarr.map(async (readarrSetting) => {
          const readarr = new ReadarrAPI({
            apiKey: readarrSetting.apiKey,
            url: ReadarrAPI.buildUrl(readarrSetting, '/api/v1'),
          });

          return {
            id: readarrSetting.id,
            profiles: await readarr.getProfiles().catch(() => undefined),
          };
        })
      );

      // add profile names to the media requests, with undefined if not found
      let mappedRequests = requests.map((r) => {
        switch (r.type) {
          case MediaType.MOVIE: {
            const profileName = radarrServers
              .find((serverr) => serverr.id === r.serverId)
              ?.profiles?.find((profile) => profile.id === r.profileId)?.name;

            return {
              ...r,
              profileName,
            };
          }
          case MediaType.TV: {
            return {
              ...r,
              profileName: sonarrServers
                .find((serverr) => serverr.id === r.serverId)
                ?.profiles?.find((profile) => profile.id === r.profileId)?.name,
            };
          }
          case MediaType.MUSIC: {
            return {
              ...r,
              profileName: lidarrServers
                .find((serverr) => serverr.id === r.serverId)
                ?.profiles?.find((profile) => profile.id === r.profileId)?.name,
            };
          }
          case MediaType.BOOK: {
            return {
              ...r,
              profileName: readarrServers
                .find((serverr) => serverr.id === r.serverId)
                ?.profiles?.find((profile) => profile.id === r.profileId)?.name,
            };
          }
          default: {
            return {
              ...r,
              profileName: undefined,
            };
          }
        }
      });

      // add canRemove prop if user has permission
      if (req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
        mappedRequests = mappedRequests.map((r) => {
          switch (r.type) {
            case MediaType.MOVIE: {
              return {
                ...r,
                // check if the radarr server for this request is configured
                canRemove: radarrServers.some(
                  (server) =>
                    server.id ===
                    (r.is4k ? r.media.serviceId4k : r.media.serviceId)
                ),
              };
            }
            case MediaType.TV: {
              return {
                ...r,
                // check if the sonarr server for this request is configured
                canRemove: sonarrServers.some(
                  (server) =>
                    server.id ===
                    (r.is4k ? r.media.serviceId4k : r.media.serviceId)
                ),
              };
            }
            case MediaType.MUSIC: {
              return {
                ...r,
                canRemove: lidarrServers.some(
                  (server) => server.id === r.media.serviceId
                ),
              };
            }
            case MediaType.BOOK: {
              const hasEbookLink =
                r.media.serviceId !== null &&
                r.media.serviceId !== undefined &&
                r.media.externalServiceId !== null &&
                r.media.externalServiceId !== undefined;
              const hasAudiobookLink =
                r.media.audiobookServiceId !== null &&
                r.media.audiobookServiceId !== undefined &&
                r.media.audiobookExternalServiceId !== null &&
                r.media.audiobookExternalServiceId !== undefined;
              const canRemoveEbook =
                hasEbookLink &&
                readarrServers.some(
                  (server) => server.id === r.media.serviceId
                );
              const canRemoveAudiobook =
                hasAudiobookLink &&
                readarrServers.some(
                  (server) => server.id === r.media.audiobookServiceId
                );

              return {
                ...r,
                canRemove:
                  r.bookFormat === 'audiobook'
                    ? canRemoveAudiobook
                    : r.bookFormat === 'both'
                      ? (hasEbookLink || hasAudiobookLink) &&
                        (!hasEbookLink || canRemoveEbook) &&
                        (!hasAudiobookLink || canRemoveAudiobook)
                      : canRemoveEbook,
              };
            }
            default: {
              return {
                ...r,
                canRemove: false,
              };
            }
          }
        });
      }

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(requestCount / pageSize),
          pageSize,
          results: requestCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: mappedRequests,
        serviceErrors: {
          radarr: radarrServers
            .filter((s) => !s.profiles)
            .map((s) => ({
              id: s.id,
              name:
                settings.radarr.find((r) => r.id === s.id)?.name ||
                `Radarr ${s.id}`,
            })),
          sonarr: sonarrServers
            .filter((s) => !s.profiles)
            .map((s) => ({
              id: s.id,
              name:
                settings.sonarr.find((r) => r.id === s.id)?.name ||
                `Sonarr ${s.id}`,
            })),
          lidarr: lidarrServers
            .filter((s) => !s.profiles)
            .map((s) => ({
              id: s.id,
              name:
                settings.lidarr.find((r) => r.id === s.id)?.name ||
                `Lidarr ${s.id}`,
            })),
          readarr: readarrServers
            .filter((s) => !s.profiles)
            .map((s) => ({
              id: s.id,
              name:
                settings.readarr.find((r) => r.id === s.id)?.name ||
                `Bookshelf ${s.id}`,
            })),
        },
      });
    } catch (e) {
      if (e instanceof ServiceConfigurationError) {
        return next({ status: 400, message: e.message });
      }

      next({ status: 500, message: e.message });
    }
  }
);

requestRoutes.post<never, MediaRequest, MediaRequestBody>(
  '/',
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to request media.',
        });
      }
      const request = await MediaRequest.request(req.body, req.user);

      return res.status(201).json(request);
    } catch (error) {
      if (!(error instanceof Error)) {
        return;
      }

      switch (error.constructor) {
        case RequestPermissionError:
        case QuotaRestrictedError:
          return next({ status: 403, message: error.message });
        case DuplicateMediaRequestError:
          return next({ status: 409, message: error.message });
        case ServiceConfigurationError:
          return next({ status: 400, message: error.message });
        case NoSeasonsAvailableError:
          return next({ status: 202, message: error.message });
        case BlocklistedMediaError:
          return next({ status: 403, message: error.message });
        default:
          return next({ status: 500, message: error.message });
      }
    }
  }
);

requestRoutes.post<never, BulkMediaRequestResponse, BulkMediaRequestBody>(
  '/bulk',
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to request media.',
        });
      }

      if (
        req.body.mediaType !== MediaType.MUSIC &&
        req.body.mediaType !== MediaType.BOOK
      ) {
        return next({
          status: 400,
          message: 'Bulk requests only support music and books.',
        });
      }

      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        return next({
          status: 400,
          message: 'At least one item is required.',
        });
      }

      let requestUser = req.user;

      if (req.body.userId) {
        if (
          !req.user.hasPermission([
            Permission.MANAGE_USERS,
            Permission.MANAGE_REQUESTS,
          ])
        ) {
          return next({
            status: 403,
            message: 'You do not have permission to modify the request user.',
          });
        }

        requestUser = await getRepository(User).findOneOrFail({
          where: { id: req.body.userId },
        });
      }

      const quotas = await requestUser.getQuota();
      const quota =
        req.body.mediaType === MediaType.MUSIC ? quotas.music : quotas.book;

      if (quota.limit && (quota.remaining ?? 0) < req.body.items.length) {
        return next({
          status: 403,
          message: `${req.body.mediaType === MediaType.MUSIC ? 'Music' : 'Book'} quota exceeded.`,
        });
      }

      const created: MediaRequest[] = [];
      const skipped: BulkMediaRequestResponse['skipped'] = [];
      const failed: BulkMediaRequestResponse['failed'] = [];

      for (const item of req.body.items) {
        if (!item.mediaId) {
          failed.push({
            mediaId: item.mediaId,
            title: item.title,
            reason: 'Missing media ID.',
          });
          continue;
        }

        try {
          const coveredReason = await getBulkCoveredReason(
            req.body.mediaType,
            item.mediaId,
            req.body.format
          );

          if (coveredReason) {
            skipped.push({
              mediaId: item.mediaId,
              title: item.title,
              reason: coveredReason,
            });
            continue;
          }

          const request = await MediaRequest.request(
            {
              mediaType: req.body.mediaType,
              mediaId: item.mediaId,
              format: req.body.format,
              isbn13: item.isbn13,
              editionId: item.editionId,
              authorId: item.authorId,
              serverId: req.body.serverId,
              profileId: req.body.profileId,
              profileName: req.body.profileName,
              rootFolder: req.body.rootFolder,
              metadataProfileId: req.body.metadataProfileId,
              userId: req.body.userId,
              tags: req.body.tags,
            },
            req.user
          );

          created.push(request);
        } catch (error) {
          if (!(error instanceof Error)) {
            failed.push({
              mediaId: item.mediaId,
              title: item.title,
              reason: 'Unknown error.',
            });
            continue;
          }

          if (
            error instanceof DuplicateMediaRequestError ||
            error instanceof BlocklistedMediaError
          ) {
            skipped.push({
              mediaId: item.mediaId,
              title: item.title,
              reason: error.message,
            });
            continue;
          }

          if (
            error instanceof RequestPermissionError ||
            error instanceof QuotaRestrictedError
          ) {
            return next({ status: 403, message: error.message });
          }

          if (error instanceof ServiceConfigurationError) {
            return next({ status: 400, message: error.message });
          }

          failed.push({
            mediaId: item.mediaId,
            title: item.title,
            reason: error.message,
          });
        }
      }

      return res.status(207).json({ created, skipped, failed });
    } catch (error) {
      if (error instanceof Error) {
        return next({ status: 500, message: error.message });
      }

      return next({ status: 500, message: 'Unable to submit bulk request.' });
    }
  }
);

requestRoutes.get('/count', async (_req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const query = requestRepository
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.media', 'media');

    const totalCount = await query.getCount();

    const movieCount = await query
      .where('request.type = :requestType', {
        requestType: MediaType.MOVIE,
      })
      .getCount();

    const tvCount = await query
      .where('request.type = :requestType', {
        requestType: MediaType.TV,
      })
      .getCount();

    const musicCount = await query
      .where('request.type = :requestType', {
        requestType: MediaType.MUSIC,
      })
      .getCount();

    const bookCount = await query
      .where('request.type = :requestType', {
        requestType: MediaType.BOOK,
      })
      .getCount();

    const pendingCount = await query
      .where('request.status = :requestStatus', {
        requestStatus: MediaRequestStatus.PENDING,
      })
      .getCount();

    const approvedCount = await query
      .where('request.status = :requestStatus', {
        requestStatus: MediaRequestStatus.APPROVED,
      })
      .getCount();

    const declinedCount = await query
      .where('request.status = :requestStatus', {
        requestStatus: MediaRequestStatus.DECLINED,
      })
      .getCount();

    const approvedRequests = await requestRepository.find({
      where: { status: MediaRequestStatus.APPROVED },
      relations: { media: true },
    });

    const availableCount = approvedRequests.filter(isRequestAvailable).length;
    const processingCount = approvedRequests.length - availableCount;

    const completedCount = await query
      .where('request.status = :requestStatus', {
        requestStatus: MediaRequestStatus.COMPLETED,
      })
      .getCount();

    return res.status(200).json({
      total: totalCount,
      movie: movieCount,
      tv: tvCount,
      music: musicCount,
      book: bookCount,
      pending: pendingCount,
      approved: approvedCount,
      declined: declinedCount,
      processing: processingCount,
      available: availableCount,
      completed: completedCount,
    });
  } catch (e) {
    logger.error('Something went wrong retrieving request counts', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Unable to retrieve request counts.' });
  }
});

requestRoutes.get('/:requestId', async (req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const request = await requestRepository.findOneOrFail({
      where: { id: Number(req.params.requestId) },
      relations: {
        requestedBy: true,
        modifiedBy: true,
        media: { identifiers: true },
      },
    });

    if (
      request.requestedBy.id !== req.user?.id &&
      !req.user?.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
        { type: 'or' }
      )
    ) {
      return next({
        status: 403,
        message: 'You do not have permission to view this request.',
      });
    }

    return res.status(200).json(request);
  } catch (e) {
    logger.debug('Failed to retrieve request.', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 404, message: 'Request not found.' });
  }
});

requestRoutes.put<{ requestId: string }>(
  '/:requestId',
  async (req, res, next) => {
    const requestRepository = getRepository(MediaRequest);
    const userRepository = getRepository(User);
    try {
      const request = await requestRepository.findOne({
        where: {
          id: Number(req.params.requestId),
        },
      });

      if (!request) {
        return next({ status: 404, message: 'Request not found.' });
      }

      if (req.body.mediaType && req.body.mediaType !== request.type) {
        return next({
          status: 400,
          message: 'Request media type cannot be changed.',
        });
      }

      if (
        (request.requestedBy.id !== req.user?.id ||
          (request.type !== MediaType.TV &&
            !req.user?.hasPermission(Permission.REQUEST_ADVANCED))) &&
        !req.user?.hasPermission(Permission.MANAGE_REQUESTS)
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this request.',
        });
      }

      let requestUser = request.requestedBy;

      if (
        req.body.userId &&
        req.body.userId !== request.requestedBy.id &&
        !req.user?.hasPermission([
          Permission.MANAGE_USERS,
          Permission.MANAGE_REQUESTS,
        ])
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to modify the request user.',
        });
      } else if (req.body.userId) {
        requestUser = await userRepository.findOneOrFail({
          where: { id: req.body.userId },
        });
      }

      if (request.type === MediaType.MOVIE) {
        request.serverId = req.body.serverId;
        request.profileId = req.body.profileId;
        request.rootFolder = req.body.rootFolder;
        request.tags = req.body.tags;
        request.requestedBy = requestUser as User;

        await requestRepository.save(request);
      } else if (
        request.type === MediaType.MUSIC ||
        request.type === MediaType.BOOK
      ) {
        const nextServerId =
          req.body.serverId === undefined
            ? request.serverId
            : req.body.serverId;
        const nextBookFormat =
          request.type === MediaType.BOOK
            ? (req.body.format ?? request.bookFormat ?? 'ebook')
            : null;

        validateExternalServiceConfiguration(
          request.type,
          nextServerId,
          nextBookFormat
        );

        if (req.body.serverId !== undefined) {
          request.serverId = req.body.serverId;
        }
        if (req.body.profileId !== undefined) {
          request.profileId = req.body.profileId;
        }
        if (req.body.metadataProfileId !== undefined) {
          request.metadataProfileId = req.body.metadataProfileId;
        }
        if (req.body.rootFolder !== undefined) {
          request.rootFolder = req.body.rootFolder;
        }
        if (req.body.tags !== undefined) {
          request.tags = req.body.tags;
        }
        request.requestedBy = requestUser as User;
        if (request.type === MediaType.BOOK) {
          request.bookFormat = req.body.format ?? request.bookFormat ?? 'ebook';
        }

        await requestRepository.save(request);
      } else if (request.type === MediaType.TV) {
        const mediaRepository = getRepository(Media);
        request.serverId = req.body.serverId;
        request.profileId = req.body.profileId;
        request.rootFolder = req.body.rootFolder;
        request.languageProfileId = req.body.languageProfileId;
        request.tags = req.body.tags;
        request.requestedBy = requestUser as User;

        const requestedSeasons = req.body.seasons as number[] | undefined;

        if (!requestedSeasons || requestedSeasons.length === 0) {
          throw new Error(
            'Missing seasons. If you want to cancel a series request, use the DELETE method.'
          );
        }

        // Get existing media so we can work with all the requests
        const media = await mediaRepository.findOneOrFail({
          where: { tmdbId: request.media.tmdbId, mediaType: MediaType.TV },
          relations: { requests: true },
        });

        // Get all requested seasons that are not part of this request we are editing
        const existingSeasons = media.requests
          .filter(
            (r) =>
              r.is4k === request.is4k &&
              r.id !== request.id &&
              r.status !== MediaRequestStatus.DECLINED &&
              r.status !== MediaRequestStatus.COMPLETED
          )
          .reduce((seasons, r) => {
            const combinedSeasons = r.seasons.map(
              (season) => season.seasonNumber
            );

            return [...seasons, ...combinedSeasons];
          }, [] as number[]);

        const filteredSeasons = requestedSeasons.filter(
          (rs) => !existingSeasons.includes(rs)
        );

        if (filteredSeasons.length === 0) {
          return next({
            status: 202,
            message: 'No seasons available to request',
          });
        }

        const newSeasons = requestedSeasons.filter(
          (sn) => !request.seasons.map((s) => s.seasonNumber).includes(sn)
        );

        request.seasons = request.seasons.filter((rs) =>
          filteredSeasons.includes(rs.seasonNumber)
        );

        if (newSeasons.length > 0) {
          logger.debug('Adding new seasons to request', {
            label: 'Media Request',
            newSeasons,
          });
          request.seasons.push(
            ...newSeasons.map(
              (ns) =>
                new SeasonRequest({
                  seasonNumber: ns,
                  status: MediaRequestStatus.PENDING,
                })
            )
          );
        }

        await requestRepository.save(request);
      }

      return res.status(200).json(request);
    } catch (e) {
      if (e instanceof ServiceConfigurationError) {
        return next({ status: 400, message: e.message });
      }

      next({ status: 500, message: e.message });
    }
  }
);

requestRoutes.delete('/:requestId', async (req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const request = await requestRepository.findOneOrFail({
      where: { id: Number(req.params.requestId) },
      relations: { requestedBy: true, modifiedBy: true },
    });

    if (
      !req.user?.hasPermission(Permission.MANAGE_REQUESTS) &&
      (request.requestedBy.id !== req.user?.id ||
        request.status !== MediaRequestStatus.PENDING)
    ) {
      return next({
        status: 401,
        message: 'You do not have permission to delete this request.',
      });
    }

    await requestRepository.remove(request);

    return res.status(204).send();
  } catch (e) {
    logger.error('Something went wrong deleting a request.', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 404, message: 'Request not found.' });
  }
});

requestRoutes.post<{
  requestId: string;
}>(
  '/:requestId/retry',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const requestRepository = getRepository(MediaRequest);

    try {
      const request = await requestRepository.findOneOrFail({
        where: { id: Number(req.params.requestId) },
        relations: { requestedBy: true, modifiedBy: true },
      });

      // this also triggers updating the parent media's status & sending to *arr
      validateExternalServiceConfiguration(
        request.type,
        request.serverId,
        request.bookFormat
      );

      request.status = MediaRequestStatus.APPROVED;
      request.modifiedBy = req.user;
      await requestRepository.save(request);

      return res.status(200).json(request);
    } catch (e) {
      if (e instanceof ServiceConfigurationError) {
        return next({ status: 400, message: e.message });
      }

      logger.error('Error processing request retry', {
        label: 'Media Request',
        message: e.message,
      });
      next({ status: 404, message: 'Request not found.' });
    }
  }
);

requestRoutes.post<{
  requestId: string;
  status: 'pending' | 'approve' | 'decline';
}>(
  '/:requestId/:status',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const requestRepository = getRepository(MediaRequest);

    try {
      const request = await requestRepository.findOneOrFail({
        where: { id: Number(req.params.requestId) },
        relations: { requestedBy: true, modifiedBy: true },
      });

      let newStatus: MediaRequestStatus;

      switch (req.params.status) {
        case 'pending':
          newStatus = MediaRequestStatus.PENDING;
          break;
        case 'approve':
          newStatus = MediaRequestStatus.APPROVED;
          break;
        case 'decline':
          newStatus = MediaRequestStatus.DECLINED;
          break;
      }

      if (newStatus === MediaRequestStatus.APPROVED) {
        validateExternalServiceConfiguration(
          request.type,
          request.serverId,
          request.bookFormat
        );
      }

      request.status = newStatus;
      request.modifiedBy = req.user;
      await requestRepository.save(request);

      return res.status(200).json(request);
    } catch (e) {
      if (e instanceof ServiceConfigurationError) {
        return next({ status: 400, message: e.message });
      }

      logger.error('Error processing request update', {
        label: 'Media Request',
        message: e.message,
      });
      next({ status: 404, message: 'Request not found.' });
    }
  }
);

export default requestRoutes;
