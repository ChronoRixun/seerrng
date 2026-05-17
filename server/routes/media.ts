import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TautulliAPI from '@server/api/tautulli';
import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Season from '@server/entity/Season';
import { User } from '@server/entity/User';
import type {
  MediaResultsResponse,
  MediaWatchDataResponse,
} from '@server/interfaces/api/mediaInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { parsePageParams } from '@server/utils/pagination';
import {
  parseOptionalAllowedString,
  parseOptionalBodyBoolean,
  parseOptionalNonNegativeInteger,
  parseOptionalQueryBoolean,
} from '@server/utils/validation';
import { Router } from 'express';
import type { FindOneOptions } from 'typeorm';
import { In, IsNull, Not } from 'typeorm';

const mediaRoutes = Router();
const maxMediaId = 1_000_000_000;
const maxSeasonCount = 500;
const maxSeasonNumber = 10_000;
const mediaListFilters = [
  'available',
  'partial',
  'allavailable',
  'processing',
  'pending',
] as const;
const mediaListSorts = ['modified', 'mediaAdded'] as const;
const mediaFileFormats = ['ebook', 'audiobook', 'both'] as const;

const parseMediaRouteId = (id: unknown): number | undefined => {
  const parsedValue =
    typeof id === 'string' && id.trim() !== '' ? Number(id) : id;
  const parsed = parseOptionalNonNegativeInteger(parsedValue, maxMediaId);

  return parsed && parsed > 0 ? parsed : undefined;
};

const mediaStatusActions = [
  'available',
  'partial',
  'processing',
  'pending',
  'unknown',
] as const;
type MediaStatusAction = (typeof mediaStatusActions)[number];

const parseMediaStatusAction = (
  status: unknown
): MediaStatusAction | undefined =>
  typeof status === 'string' &&
  mediaStatusActions.includes(status as MediaStatusAction)
    ? (status as MediaStatusAction)
    : undefined;

const parseSeasonStatusUpdates = (
  seasons: unknown
): { seasons: { seasonNumber: number }[] } | { error: string } => {
  if (seasons === undefined || seasons === null) {
    return { seasons: [] };
  }

  if (!Array.isArray(seasons)) {
    return { error: 'seasons must be an array.' };
  }

  if (seasons.length > maxSeasonCount) {
    return { error: `seasons are limited to ${maxSeasonCount} values.` };
  }

  const parsedSeasons: { seasonNumber: number }[] = [];

  for (const season of seasons) {
    if (season === null || typeof season !== 'object') {
      return { error: 'seasons must contain season objects.' };
    }

    const seasonNumber = parseOptionalNonNegativeInteger(
      (season as { seasonNumber?: unknown }).seasonNumber,
      maxSeasonNumber
    );

    if (seasonNumber === undefined) {
      return {
        error: `seasonNumber must be an integer no greater than ${maxSeasonNumber}.`,
      };
    }

    if (!parsedSeasons.some((s) => s.seasonNumber === seasonNumber)) {
      parsedSeasons.push({ seasonNumber });
    }
  }

  return { seasons: parsedSeasons };
};

mediaRoutes.get('/', async (req, res, next) => {
  const mediaRepository = getRepository(Media);

  const { pageSize, skip } = parsePageParams(req.query, {
    take: 20,
    maxTake: 100,
  });
  const parsedFilter = parseOptionalAllowedString(req.query.filter, {
    fieldName: 'Filter',
    allowedValues: mediaListFilters,
    maxLength: 32,
  });
  if ('error' in parsedFilter) {
    return next({ status: 400, message: parsedFilter.error });
  }
  const parsedSort = parseOptionalAllowedString(req.query.sort, {
    fieldName: 'Sort',
    allowedValues: mediaListSorts,
    maxLength: 32,
  });
  if ('error' in parsedSort) {
    return next({ status: 400, message: parsedSort.error });
  }
  const filter = parsedFilter.value;
  const sort = parsedSort.value;

  let statusFilter = undefined;

  switch (filter) {
    case 'available':
      statusFilter = MediaStatus.AVAILABLE;
      break;
    case 'partial':
      statusFilter = MediaStatus.PARTIALLY_AVAILABLE;
      break;
    case 'allavailable':
      statusFilter = In([
        MediaStatus.AVAILABLE,
        MediaStatus.PARTIALLY_AVAILABLE,
      ]);
      break;
    case 'processing':
      statusFilter = MediaStatus.PROCESSING;
      break;
    case 'pending':
      statusFilter = MediaStatus.PENDING;
      break;
  }

  let sortFilter: FindOneOptions<Media>['order'] = {
    id: 'DESC',
  };

  switch (sort) {
    case 'modified':
      sortFilter = {
        updatedAt: 'DESC',
      };
      break;
    case 'mediaAdded':
      sortFilter = {
        mediaAddedAt: 'DESC',
      };
  }

  let whereClause: FindOneOptions<Media>['where'];
  if (statusFilter || sort === 'mediaAdded') {
    whereClause = {};
    if (statusFilter) whereClause.status = statusFilter;
    if (sort === 'mediaAdded') whereClause.mediaAddedAt = Not(IsNull());
  }

  try {
    const [media, mediaCount] = await mediaRepository.findAndCount({
      order: sortFilter,
      where: whereClause,
      take: pageSize,
      skip,
    });
    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(mediaCount / pageSize),
        pageSize,
        results: mediaCount,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: filterEntityResponse(media),
    } as MediaResultsResponse);
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

mediaRoutes.post<
  {
    id: string;
    status: 'available' | 'partial' | 'processing' | 'pending' | 'unknown';
  },
  Media
>(
  '/:id/:status',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const mediaRepository = getRepository(Media);
    const seasonRepository = getRepository(Season);
    const mediaId = parseMediaRouteId(req.params.id);
    if (!mediaId) {
      return next({ status: 404, message: 'Media does not exist.' });
    }
    const statusAction = parseMediaStatusAction(req.params.status);
    if (!statusAction) {
      return next({ status: 404, message: 'Media status does not exist.' });
    }

    const media = await mediaRepository.findOne({
      where: { id: mediaId },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    const parsedIs4k = parseOptionalBodyBoolean(req.body.is4k, 'is4k');
    if ('error' in parsedIs4k) {
      return next({ status: 400, message: parsedIs4k.error });
    }
    const is4k = parsedIs4k.value ?? false;

    switch (statusAction) {
      case 'available':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.AVAILABLE;

        if (media.mediaType === MediaType.TV) {
          const expectedSeasons = parseSeasonStatusUpdates(req.body.seasons);
          if ('error' in expectedSeasons) {
            return next({ status: 400, message: expectedSeasons.error });
          }

          for (const expectedSeason of expectedSeasons.seasons) {
            let season = media.seasons.find(
              (s) => s.seasonNumber === expectedSeason.seasonNumber
            );

            if (!season) {
              // Create the season if it doesn't exist
              season = seasonRepository.create({
                seasonNumber: expectedSeason.seasonNumber,
              });
              media.seasons.push(season);
            }

            season[is4k ? 'status4k' : 'status'] = MediaStatus.AVAILABLE;
          }
        }
        break;
      case 'partial':
        if (media.mediaType === MediaType.MOVIE) {
          return next({
            status: 400,
            message: 'Only series can be set to be partially available',
          });
        }
        media[is4k ? 'status4k' : 'status'] = MediaStatus.PARTIALLY_AVAILABLE;
        break;
      case 'processing':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.PROCESSING;
        break;
      case 'pending':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.PENDING;
        break;
      case 'unknown':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.UNKNOWN;
        break;
      default:
        return next({ status: 404, message: 'Media status does not exist.' });
    }

    await mediaRepository.save(media);

    return res.status(200).json(filterEntityResponse(media));
  }
);

mediaRoutes.delete(
  '/:id',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const mediaRepository = getRepository(Media);
      const mediaId = parseMediaRouteId(req.params.id);
      if (!mediaId) {
        return next({ status: 404, message: 'Media not found' });
      }

      const media = await mediaRepository.findOneOrFail({
        where: { id: mediaId },
      });

      if (media.status === MediaStatus.BLOCKLISTED) {
        media.resetServiceData();
        await mediaRepository.save(media);
      } else {
        await mediaRepository.remove(media);
      }

      return res.status(204).send();
    } catch (e) {
      logger.error('Something went wrong fetching media in delete request', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 404, message: 'Media not found' });
    }
  }
);

mediaRoutes.delete(
  '/:id/file',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const mediaRepository = getRepository(Media);
      const mediaId = parseMediaRouteId(req.params.id);
      if (!mediaId) {
        return next({ status: 404, message: 'Media not found' });
      }
      const media = await mediaRepository.findOneOrFail({
        where: { id: mediaId },
      });

      const parsedIs4k = parseOptionalQueryBoolean(req.query.is4k, 'is4k');
      if ('error' in parsedIs4k) {
        return next({ status: 400, message: parsedIs4k.error });
      }
      const is4k = parsedIs4k.value ?? false;
      const isMovie = media.mediaType === MediaType.MOVIE;
      const isMusic = media.mediaType === MediaType.MUSIC;
      const isBook = media.mediaType === MediaType.BOOK;
      const parsedBookFormat = parseOptionalAllowedString(req.query.format, {
        fieldName: 'Format',
        allowedValues: mediaFileFormats,
        maxLength: 16,
      });
      if ('error' in parsedBookFormat) {
        return next({ status: 400, message: parsedBookFormat.error });
      }
      const bookFormat = parsedBookFormat.value ?? 'both';

      let serviceSettings;
      if (isMovie) {
        serviceSettings = settings.radarr.find(
          (radarr) => radarr.isDefault && radarr.is4k === is4k
        );
      } else if (isMusic) {
        serviceSettings = settings.lidarr.find((lidarr) => lidarr.isDefault);
      } else if (isBook) {
        serviceSettings = settings.readarr.find((readarr) => readarr.isDefault);
      } else {
        serviceSettings = settings.sonarr.find(
          (sonarr) => sonarr.isDefault && sonarr.is4k === is4k
        );
      }

      const specificServiceId = is4k ? media.serviceId4k : media.serviceId;
      if (
        specificServiceId &&
        specificServiceId >= 0 &&
        serviceSettings?.id !== specificServiceId
      ) {
        if (isMovie) {
          serviceSettings = settings.radarr.find(
            (radarr) => radarr.id === specificServiceId
          );
        } else if (isMusic) {
          serviceSettings = settings.lidarr.find(
            (lidarr) => lidarr.id === specificServiceId
          );
        } else if (isBook) {
          serviceSettings = settings.readarr.find(
            (readarr) => readarr.id === specificServiceId
          );
        } else {
          serviceSettings = settings.sonarr.find(
            (sonarr) => sonarr.id === specificServiceId
          );
        }
      }

      const hasBookServiceLink =
        isBook &&
        ((media.serviceId !== null &&
          media.serviceId !== undefined &&
          media.externalServiceId !== null &&
          media.externalServiceId !== undefined) ||
          (media.audiobookServiceId !== null &&
            media.audiobookServiceId !== undefined &&
            media.audiobookExternalServiceId !== null &&
            media.audiobookExternalServiceId !== undefined));

      if (!serviceSettings && !hasBookServiceLink) {
        const serviceName = isMovie
          ? 'Radarr'
          : isMusic
            ? 'Lidarr'
            : isBook
              ? 'Bookshelf'
              : 'Sonarr';
        logger.warn(
          `There is no configured ${is4k ? '4K ' : ''}${serviceName} server for this media item.`,
          {
            label: 'Media Request',
            mediaId: media.id,
          }
        );
        return next({
          status: 404,
          message: `${serviceName} server not configured.`,
        });
      }

      let service;
      if (isMovie) {
        service = new RadarrAPI({
          apiKey: serviceSettings!.apiKey,
          url: RadarrAPI.buildUrl(serviceSettings!, '/api/v3'),
        });
      } else if (isMusic) {
        service = new LidarrAPI({
          apiKey: serviceSettings!.apiKey,
          url: LidarrAPI.buildUrl(serviceSettings!, '/api/v1'),
        });
      } else if (!isBook) {
        service = new SonarrAPI({
          apiKey: serviceSettings!.apiKey,
          url: SonarrAPI.buildUrl(serviceSettings!, '/api/v3'),
        });
      }

      if (isMovie) {
        await (service as RadarrAPI).removeMovie(media.tmdbId);
      } else if (isMusic) {
        if (!media.externalServiceId) {
          throw new Error('Lidarr album ID not found');
        }
        await (service as LidarrAPI).removeAlbum(media.externalServiceId);
      } else if (isBook) {
        const removeEbook = bookFormat !== 'audiobook';
        const removeAudiobook = bookFormat !== 'ebook';
        let removedBookFormat = false;

        const updateBookStatus = async () => {
          const hasRemainingBookServiceLink =
            (media.serviceId !== null &&
              media.serviceId !== undefined &&
              media.externalServiceId !== null &&
              media.externalServiceId !== undefined) ||
            (media.audiobookServiceId !== null &&
              media.audiobookServiceId !== undefined &&
              media.audiobookExternalServiceId !== null &&
              media.audiobookExternalServiceId !== undefined);

          media.status = hasRemainingBookServiceLink
            ? MediaStatus.PARTIALLY_AVAILABLE
            : MediaStatus.DELETED;
          await mediaRepository.save(media);
        };

        if (
          removeEbook &&
          media.serviceId !== null &&
          media.serviceId !== undefined &&
          media.externalServiceId !== null &&
          media.externalServiceId !== undefined
        ) {
          const ebookSettings = settings.readarr.find(
            (readarr) => readarr.id === media.serviceId
          );

          if (!ebookSettings) {
            throw new Error('Bookshelf ebook server not configured');
          }

          const ebookService = new ReadarrAPI({
            apiKey: ebookSettings.apiKey,
            url: ReadarrAPI.buildUrl(ebookSettings, '/api/v1'),
          });
          await ebookService.removeBook(media.externalServiceId);
          removedBookFormat = true;
          media.serviceId = null;
          media.externalServiceId = null;
          media.externalServiceSlug = null;
          await updateBookStatus();
        }

        if (
          removeAudiobook &&
          media.audiobookServiceId !== null &&
          media.audiobookServiceId !== undefined &&
          media.audiobookExternalServiceId !== null &&
          media.audiobookExternalServiceId !== undefined
        ) {
          const audiobookSettings = settings.readarr.find(
            (readarr) => readarr.id === media.audiobookServiceId
          );

          if (!audiobookSettings) {
            throw new Error('Bookshelf audiobook server not configured');
          }

          const audiobookService = new ReadarrAPI({
            apiKey: audiobookSettings.apiKey,
            url: ReadarrAPI.buildUrl(audiobookSettings, '/api/v1'),
          });
          await audiobookService.removeBook(media.audiobookExternalServiceId);
          removedBookFormat = true;
          media.audiobookServiceId = null;
          media.audiobookExternalServiceId = null;
          media.audiobookExternalServiceSlug = null;
          await updateBookStatus();
        }

        if (!removedBookFormat) {
          throw new Error('Bookshelf book ID not found');
        }
      } else {
        const tmdb = new TheMovieDb();
        const series = await tmdb.getTvShow({ tvId: media.tmdbId });
        const tvdbId = series.external_ids.tvdb_id ?? media.tvdbId;
        if (!tvdbId) {
          throw new Error('TVDB ID not found');
        }
        await (service as SonarrAPI).removeSeries(tvdbId);
      }

      if (isBook) {
        // Book format links are saved as each backend removal succeeds.
      } else if (isMusic) {
        media.status = MediaStatus.DELETED;
        media.resetServiceData();
        await mediaRepository.save(media);
      }

      return res.status(204).send();
    } catch (e) {
      logger.error('Something went wrong fetching media in delete request', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 404, message: 'Media not found' });
    }
  }
);

mediaRoutes.get<{ id: string }, MediaWatchDataResponse>(
  '/:id/watch_data',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const settings = getSettings().tautulli;

    if (!settings.hostname || !settings.port || !settings.apiKey) {
      return next({
        status: 404,
        message: 'Tautulli API not configured.',
      });
    }

    const mediaId = parseMediaRouteId(req.params.id);
    if (!mediaId) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    const media = await getRepository(Media).findOne({
      where: { id: mediaId },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    try {
      const tautulli = new TautulliAPI(settings);
      const userRepository = getRepository(User);

      const response: MediaWatchDataResponse = {};

      if (media.ratingKey) {
        const watchStats = await tautulli.getMediaWatchStats(media.ratingKey);
        const watchUsers = await tautulli.getMediaWatchUsers(media.ratingKey);
        const plexIds = watchUsers.map((u) => u.user_id);
        if (!plexIds.length) plexIds.push(-1);

        const users = await userRepository
          .createQueryBuilder('user')
          .where('user.plexId IN (:...plexIds)', { plexIds })
          .getMany();

        const playCount =
          watchStats.find((i) => i.query_days == 0)?.total_plays ?? 0;

        const playCount7Days =
          watchStats.find((i) => i.query_days == 7)?.total_plays ?? 0;

        const playCount30Days =
          watchStats.find((i) => i.query_days == 30)?.total_plays ?? 0;

        response.data = {
          users: users,
          playCount,
          playCount7Days,
          playCount30Days,
        };
      }

      if (media.ratingKey4k) {
        const watchStats4k = await tautulli.getMediaWatchStats(
          media.ratingKey4k
        );
        const watchUsers4k = await tautulli.getMediaWatchUsers(
          media.ratingKey4k
        );
        const plexIds4k = watchUsers4k.map((u) => u.user_id);
        if (!plexIds4k.length) plexIds4k.push(-1);

        const users = await userRepository
          .createQueryBuilder('user')
          .where('user.plexId IN (:...plexIds)', { plexIds: plexIds4k })
          .getMany();

        const playCount =
          watchStats4k.find((i) => i.query_days == 0)?.total_plays ?? 0;

        const playCount7Days =
          watchStats4k.find((i) => i.query_days == 7)?.total_plays ?? 0;

        const playCount30Days =
          watchStats4k.find((i) => i.query_days == 30)?.total_plays ?? 0;

        response.data4k = {
          users,
          playCount,
          playCount7Days,
          playCount30Days,
        };
      }

      return res.status(200).json(response);
    } catch (e) {
      logger.error('Something went wrong fetching media watch data', {
        label: 'API',
        errorMessage: e.message,
        mediaId: req.params.id,
      });
      next({ status: 500, message: 'Failed to fetch watch data.' });
    }
  }
);

export default mediaRoutes;
