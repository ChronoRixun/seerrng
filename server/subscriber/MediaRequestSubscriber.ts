import type { LidarrAlbumOptions } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import type { ReadarrBookLookupResult } from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import type { RadarrMovieOptions } from '@server/api/servarr/radarr';
import RadarrAPI from '@server/api/servarr/radarr';
import type {
  AddSeriesOptions,
  SonarrSeries,
} from '@server/api/servarr/sonarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
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
import { MediaRequest } from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import SeasonRequest from '@server/entity/SeasonRequest';
import notificationManager, { Notification } from '@server/lib/notifications';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isEqual, truncate } from 'lodash';
import type {
  EntityManager,
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { EventSubscriber, Not } from 'typeorm';

const sanitizeDisplayName = (displayName: string): string => {
  return displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

@EventSubscriber()
export class MediaRequestSubscriber implements EntitySubscriberInterface<MediaRequest> {
  private async notifyAvailableMovie(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    // Get fresh media state using event manager
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
      });
    }
    if (!latestMedia) {
      const mediaRepository = getRepository(Media);
      latestMedia = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });
    }

    // Check availability using fresh media state
    if (
      !latestMedia ||
      latestMedia[entity.is4k ? 'status4k' : 'status'] !== MediaStatus.AVAILABLE
    ) {
      return;
    }

    const tmdb = new TheMovieDb();

    try {
      const movie = await tmdb.getMovie({
        movieId: entity.media.tmdbId,
      });

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: `${entity.is4k ? '4K ' : ''}Movie Request Now Available`,
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        subject: `${movie.title}${
          movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
        }`,
        message: truncate(movie.overview, {
          length: 500,
          separator: /\s/,
          omission: '…',
        }),
        media: latestMedia,
        mediaUrl: `/movie/${latestMedia.tmdbId}`,
        image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`,
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending media notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        mediaId: entity.id,
      });
    }
  }

  private async notifyAvailableSeries(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    // Get fresh media state with seasons using event manager
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
        relations: { seasons: true },
      });
    }
    if (!latestMedia) {
      const mediaRepository = getRepository(Media);
      latestMedia = await mediaRepository.findOne({
        where: { id: entity.media.id },
        relations: { seasons: true },
      });
    }

    if (!latestMedia) {
      return;
    }

    // Check availability using fresh media state
    const requestedSeasons =
      entity.seasons?.map((entitySeason) => entitySeason.seasonNumber) ?? [];
    const availableSeasons = latestMedia.seasons.filter(
      (season) =>
        season[entity.is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE &&
        requestedSeasons.includes(season.seasonNumber)
    );
    const isMediaAvailable =
      availableSeasons.length > 0 &&
      availableSeasons.length === requestedSeasons.length;

    if (!isMediaAvailable) {
      return;
    }

    const tmdb = new TheMovieDb();

    try {
      const tv = await tmdb.getTvShow({ tvId: entity.media.tmdbId });

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: `${entity.is4k ? '4K ' : ''}Series Request Now Available`,
        subject: `${tv.name}${
          tv.first_air_date ? ` (${tv.first_air_date.slice(0, 4)})` : ''
        }`,
        message: truncate(tv.overview, {
          length: 500,
          separator: /\s/,
          omission: '…',
        }),
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tv.poster_path}`,
        media: latestMedia,
        mediaUrl: `/tv/${latestMedia.tmdbId}`,
        extra: [
          {
            name: 'Requested Seasons',
            value: entity.seasons
              .map((season) => season.seasonNumber)
              .join(', '),
          },
        ],
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending media notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        mediaId: entity.id,
      });
    }
  }

  private async notifyAvailableMusic(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
      });
    }
    if (!latestMedia) {
      latestMedia = await getRepository(Media).findOne({
        where: { id: entity.media.id },
      });
    }

    if (!latestMedia || latestMedia.status !== MediaStatus.AVAILABLE) {
      return;
    }

    const mbId = latestMedia.mbId ?? entity.media.mbId;

    if (!mbId) {
      return;
    }

    try {
      const album = await new ListenBrainzAPI().getAlbum(mbId);
      const releaseGroup = album.release_group_metadata.release_group;
      const artistName = album.release_group_metadata.artist.name;

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: 'Music Request Now Available',
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        subject: `${releaseGroup.name}${
          releaseGroup.date ? ` (${releaseGroup.date.slice(0, 4)})` : ''
        }`,
        message: artistName,
        media: latestMedia,
        mediaUrl: `/music/${mbId}`,
        image: album.caa_release_mbid
          ? `https://coverartarchive.org/release/${album.caa_release_mbid}/front-500`
          : undefined,
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending music notification(s)', {
        label: 'Notifications',
        errorMessage: e instanceof Error ? e.message : String(e),
        mediaId: entity.id,
      });
    }
  }

  private async notifyAvailableBook(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
        relations: { identifiers: true },
      });
    }
    if (!latestMedia) {
      latestMedia = await getRepository(Media).findOne({
        where: { id: entity.media.id },
        relations: { identifiers: true },
      });
    }

    if (!latestMedia || latestMedia.status !== MediaStatus.AVAILABLE) {
      return;
    }

    const openLibraryId = latestMedia.identifiers?.find(
      (identifier) => identifier.provider === MediaIdentifierProvider.OPENLIBRARY
    )?.value;

    if (!openLibraryId) {
      return;
    }

    try {
      const work = await new OpenLibraryAPI().getWork(openLibraryId);
      const description =
        typeof work.description === 'string'
          ? work.description
          : work.description?.value;
      const coverId = work.covers?.[0];

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: 'Book Request Now Available',
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        subject: `${work.title}${
          work.first_publish_date
            ? ` (${work.first_publish_date.match(/\d{4}/)?.[0]})`
            : ''
        }`,
        message: description
          ? truncate(description, {
              length: 500,
              separator: /\s/,
              omission: '…',
            })
          : undefined,
        media: latestMedia,
        mediaUrl: `/book/${openLibraryId}`,
        image: coverId
          ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
          : undefined,
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending book notification(s)', {
        label: 'Notifications',
        errorMessage: e instanceof Error ? e.message : String(e),
        mediaId: entity.id,
      });
    }
  }

  public async sendToRadarr(entity: MediaRequest): Promise<void> {
    if (
      entity.status === MediaRequestStatus.APPROVED &&
      entity.type === MediaType.MOVIE
    ) {
      try {
        const mediaRepository = getRepository(Media);
        const settings = getSettings();
        if (settings.radarr.length === 0 && !settings.radarr[0]) {
          logger.info(
            'No Radarr server configured, skipping request processing',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return;
        }

        let radarrSettings = settings.radarr.find(
          (radarr) => radarr.isDefault && radarr.is4k === entity.is4k
        );

        if (
          entity.serverId !== null &&
          entity.serverId >= 0 &&
          radarrSettings?.id !== entity.serverId
        ) {
          radarrSettings = settings.radarr.find(
            (radarr) => radarr.id === entity.serverId
          );
          logger.info(
            `Request has an override server: ${radarrSettings?.name}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (!radarrSettings) {
          logger.warn(
            `There is no default ${
              entity.is4k ? '4K ' : ''
            }Radarr server configured. Did you set any of your ${
              entity.is4k ? '4K ' : ''
            }Radarr servers as default?`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return;
        }

        let rootFolder = radarrSettings.activeDirectory;
        let qualityProfile = radarrSettings.activeProfileId;
        let tags = radarrSettings.tags ? [...radarrSettings.tags] : [];

        if (
          entity.rootFolder &&
          entity.rootFolder !== '' &&
          entity.rootFolder !== radarrSettings.activeDirectory
        ) {
          rootFolder = entity.rootFolder;
          logger.info(`Request has an override root folder: ${rootFolder}`, {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });
        }

        if (
          entity.profileId &&
          entity.profileId !== radarrSettings.activeProfileId
        ) {
          qualityProfile = entity.profileId;
          logger.info(
            `Request has an override quality profile ID: ${qualityProfile}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (entity.tags && !isEqual(entity.tags, radarrSettings.tags)) {
          tags = entity.tags;
          logger.info(`Request has override tags`, {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
            tagIds: tags,
          });
        }

        const tmdb = new TheMovieDb();
        const radarr = new RadarrAPI({
          apiKey: radarrSettings.apiKey,
          url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
        });
        const movie = await tmdb.getMovie({ movieId: entity.media.tmdbId });

        const media = await mediaRepository.findOne({
          where: { id: entity.media.id },
        });

        if (!media) {
          logger.error('Media data not found', {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });
          return;
        }

        if (radarrSettings.tagRequests) {
          const radarrTags = await radarr.getTags();
          // old tags had space around the hyphen
          let userTag = radarrTags.find((v) =>
            v.label.startsWith(entity.requestedBy.id + ' - ')
          );
          // new tags do not have spaces around the hyphen, since spaces are not allowed anymore
          if (!userTag) {
            userTag = radarrTags.find((v) =>
              v.label.startsWith(entity.requestedBy.id + '-')
            );
          }
          if (!userTag) {
            logger.info(`Requester has no active tag. Creating new`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              newTag:
                entity.requestedBy.id +
                '-' +
                sanitizeDisplayName(entity.requestedBy.displayName),
            });
            userTag = await radarr.createTag({
              label:
                entity.requestedBy.id +
                '-' +
                sanitizeDisplayName(entity.requestedBy.displayName),
            });
          }
          if (userTag.id) {
            if (!tags?.find((v) => v === userTag?.id)) {
              tags?.push(userTag.id);
            }
          } else {
            logger.warn(`Requester has no tag and failed to add one`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              radarrServer: radarrSettings.hostname + ':' + radarrSettings.port,
            });
          }
        }

        if (
          media[entity.is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE
        ) {
          logger.warn('Media already exists, marking request as COMPLETED', {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });

          const requestRepository = getRepository(MediaRequest);
          entity.status = MediaRequestStatus.COMPLETED;
          await requestRepository.save(entity);
          return;
        }

        const radarrMovieOptions: RadarrMovieOptions = {
          profileId: qualityProfile,
          qualityProfileId: qualityProfile,
          rootFolderPath: rootFolder,
          minimumAvailability: radarrSettings.minimumAvailability,
          title: movie.title,
          tmdbId: movie.id,
          year: Number(movie.release_date.slice(0, 4)),
          monitored: true,
          tags,
          searchNow: !radarrSettings.preventSearch,
        };

        // Run entity asynchronously so we don't wait for it on the UI side
        radarr
          .addMovie(radarrMovieOptions)
          .then(async (radarrMovie) => {
            // We grab media again here to make sure we have the latest version of it
            const media = await mediaRepository.findOne({
              where: { id: entity.media.id },
            });

            if (!media) {
              throw new Error('Media data not found');
            }

            media[entity.is4k ? 'externalServiceId4k' : 'externalServiceId'] =
              radarrMovie.id;
            media[
              entity.is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'
            ] = radarrMovie.titleSlug;
            media[entity.is4k ? 'serviceId4k' : 'serviceId'] =
              radarrSettings?.id;
            await mediaRepository.save(media);
          })
          .catch(async () => {
            try {
              const requestRepository = getRepository(MediaRequest);

              if (entity.status !== MediaRequestStatus.FAILED) {
                entity.status = MediaRequestStatus.FAILED;
                await requestRepository.save(entity);
              }
            } catch (saveError) {
              logger.error('Failed to mark request as FAILED', {
                label: 'Media Request',
                requestId: entity.id,
                errorMessage:
                  saveError instanceof Error
                    ? saveError.message
                    : String(saveError),
              });
            }

            logger.warn(
              'Something went wrong sending movie request to Radarr, marking status as FAILED',
              {
                label: 'Media Request',
                requestId: entity.id,
                mediaId: entity.media.id,
                radarrMovieOptions,
              }
            );

            MediaRequest.sendNotification(
              entity,
              media,
              Notification.MEDIA_FAILED
            );
          })
          .finally(() => {
            radarr.clearCache({
              tmdbId: movie.id,
              externalId: entity.is4k
                ? media.externalServiceId4k
                : media.externalServiceId,
            });
          });
        logger.info('Sent request to Radarr', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
      } catch (e) {
        const requestRepository = getRepository(MediaRequest);
        const mediaRepository = getRepository(Media);
        const media = await mediaRepository.findOne({
          where: { id: entity.media.id },
        });

        if (media) {
          entity.status = MediaRequestStatus.FAILED;
          await requestRepository.save(entity);

          logger.warn(
            'Failed to send movie request to Radarr due to connection or configuration error, marking status as FAILED',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              errorMessage: e.message,
            }
          );

          MediaRequest.sendNotification(
            entity,
            media,
            Notification.MEDIA_FAILED
          );
        }
      }
    }
  }

  public async sendToSonarr(entity: MediaRequest): Promise<void> {
    if (
      entity.status === MediaRequestStatus.APPROVED &&
      entity.type === MediaType.TV
    ) {
      try {
        const mediaRepository = getRepository(Media);
        const settings = getSettings();
        if (settings.sonarr.length === 0 && !settings.sonarr[0]) {
          logger.warn(
            'No Sonarr server configured, skipping request processing',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return;
        }

        let sonarrSettings = settings.sonarr.find(
          (sonarr) => sonarr.isDefault && sonarr.is4k === entity.is4k
        );

        if (
          entity.serverId !== null &&
          entity.serverId >= 0 &&
          sonarrSettings?.id !== entity.serverId
        ) {
          sonarrSettings = settings.sonarr.find(
            (sonarr) => sonarr.id === entity.serverId
          );
          logger.info(
            `Request has an override server: ${sonarrSettings?.name}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (!sonarrSettings) {
          logger.warn(
            `There is no default ${
              entity.is4k ? '4K ' : ''
            }Sonarr server configured. Did you set any of your ${
              entity.is4k ? '4K ' : ''
            }Sonarr servers as default?`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return;
        }

        const media = await mediaRepository.findOne({
          where: { id: entity.media.id },
        });

        if (!media) {
          throw new Error('Media data not found');
        }

        if (
          media[entity.is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE
        ) {
          logger.warn('Media already exists, marking request as COMPLETED', {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });

          const requestRepository = getRepository(MediaRequest);
          entity.status = MediaRequestStatus.COMPLETED;
          entity.seasons.forEach((season) => {
            season.status = MediaRequestStatus.COMPLETED;
          });
          await requestRepository.save(entity);
          return;
        }

        const tmdb = new TheMovieDb();
        const sonarr = new SonarrAPI({
          apiKey: sonarrSettings.apiKey,
          url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
        });
        const series = await tmdb.getTvShow({ tvId: media.tmdbId });
        const tvdbId = series.external_ids.tvdb_id ?? media.tvdbId;

        if (!tvdbId) {
          const requestRepository = getRepository(MediaRequest);
          await mediaRepository.remove(media);
          await requestRepository.remove(entity);
          throw new Error('TVDB ID not found');
        }

        let seriesType: SonarrSeries['seriesType'] = 'standard';

        // Change series type to anime if the anime keyword is present on tmdb
        if (
          series.keywords.results.some(
            (keyword) => keyword.id === ANIME_KEYWORD_ID
          )
        ) {
          seriesType = sonarrSettings.animeSeriesType ?? 'anime';
        }

        let rootFolder =
          seriesType === 'anime' && sonarrSettings.activeAnimeDirectory
            ? sonarrSettings.activeAnimeDirectory
            : sonarrSettings.activeDirectory;
        let qualityProfile =
          seriesType === 'anime' && sonarrSettings.activeAnimeProfileId
            ? sonarrSettings.activeAnimeProfileId
            : sonarrSettings.activeProfileId;
        let languageProfile =
          seriesType === 'anime' && sonarrSettings.activeAnimeLanguageProfileId
            ? sonarrSettings.activeAnimeLanguageProfileId
            : sonarrSettings.activeLanguageProfileId;
        let tags =
          seriesType === 'anime'
            ? sonarrSettings.animeTags
              ? [...sonarrSettings.animeTags]
              : []
            : sonarrSettings.tags
              ? [...sonarrSettings.tags]
              : [];

        if (
          entity.rootFolder &&
          entity.rootFolder !== '' &&
          entity.rootFolder !== rootFolder
        ) {
          rootFolder = entity.rootFolder;
          logger.info(`Request has an override root folder: ${rootFolder}`, {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });
        }

        if (entity.profileId && entity.profileId !== qualityProfile) {
          qualityProfile = entity.profileId;
          logger.info(
            `Request has an override quality profile ID: ${qualityProfile}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (
          entity.languageProfileId &&
          entity.languageProfileId !== languageProfile
        ) {
          languageProfile = entity.languageProfileId;
          logger.info(
            `Request has an override language profile ID: ${languageProfile}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (entity.tags && !isEqual(entity.tags, tags)) {
          tags = entity.tags;
          logger.info(`Request has override tags`, {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
            tagIds: tags,
          });
        }

        if (sonarrSettings.tagRequests) {
          const sonarrTags = await sonarr.getTags();
          // old tags had space around the hyphen
          let userTag = sonarrTags.find((v) =>
            v.label.startsWith(entity.requestedBy.id + ' - ')
          );
          // new tags do not have spaces around the hyphen, since spaces are not allowed anymore
          if (!userTag) {
            userTag = sonarrTags.find((v) =>
              v.label.startsWith(entity.requestedBy.id + '-')
            );
          }
          if (!userTag) {
            logger.info(`Requester has no active tag. Creating new`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              newTag:
                entity.requestedBy.id +
                '-' +
                sanitizeDisplayName(entity.requestedBy.displayName),
            });
            userTag = await sonarr.createTag({
              label:
                entity.requestedBy.id +
                '-' +
                sanitizeDisplayName(entity.requestedBy.displayName),
            });
          }
          if (userTag.id) {
            if (!tags?.find((v) => v === userTag?.id)) {
              tags?.push(userTag.id);
            }
          } else {
            logger.warn(`Requester has no tag and failed to add one`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              sonarrServer: sonarrSettings.hostname + ':' + sonarrSettings.port,
            });
          }
        }

        const sonarrSeriesOptions: AddSeriesOptions = {
          profileId: qualityProfile,
          languageProfileId: languageProfile,
          rootFolderPath: rootFolder,
          title: series.name,
          tvdbid: tvdbId,
          seasons: entity.seasons.map((season) => season.seasonNumber),
          seasonFolder: sonarrSettings.enableSeasonFolders,
          seriesType,
          tags,
          monitored: true,
          monitorNewItems: sonarrSettings.monitorNewItems,
          searchNow: !sonarrSettings.preventSearch,
        };

        // Run entity asynchronously so we don't wait for it on the UI side
        sonarr
          .addSeries(sonarrSeriesOptions)
          .then(async (sonarrSeries) => {
            // We grab media again here to make sure we have the latest version of it
            const media = await mediaRepository.findOne({
              where: { id: entity.media.id },
            });

            if (!media) {
              throw new Error('Media data not found');
            }

            media[entity.is4k ? 'externalServiceId4k' : 'externalServiceId'] =
              sonarrSeries.id;
            media[
              entity.is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'
            ] = sonarrSeries.titleSlug;
            media[entity.is4k ? 'serviceId4k' : 'serviceId'] =
              sonarrSettings?.id;
            await mediaRepository.save(media);
          })
          .catch(async () => {
            try {
              const requestRepository = getRepository(MediaRequest);

              if (entity.status !== MediaRequestStatus.FAILED) {
                entity.status = MediaRequestStatus.FAILED;
                await requestRepository.save(entity);
              }
            } catch (saveError) {
              logger.error('Failed to mark request as FAILED', {
                label: 'Media Request',
                requestId: entity.id,
                errorMessage:
                  saveError instanceof Error
                    ? saveError.message
                    : String(saveError),
              });
            }

            logger.warn(
              'Something went wrong sending series request to Sonarr, marking status as FAILED',
              {
                label: 'Media Request',
                requestId: entity.id,
                mediaId: entity.media.id,
                sonarrSeriesOptions,
              }
            );

            MediaRequest.sendNotification(
              entity,
              media,
              Notification.MEDIA_FAILED
            );
          })
          .finally(() => {
            sonarr.clearCache({
              tvdbId,
              externalId: entity.is4k
                ? media.externalServiceId4k
                : media.externalServiceId,
              title: series.name,
            });
          });
        logger.info('Sent request to Sonarr', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
      } catch (e) {
        const requestRepository = getRepository(MediaRequest);
        const mediaRepository = getRepository(Media);
        const media = await mediaRepository.findOne({
          where: { id: entity.media.id },
        });

        if (media) {
          entity.status = MediaRequestStatus.FAILED;
          await requestRepository.save(entity);

          logger.warn(
            'Failed to send series request to Sonarr due to connection or configuration error, marking status as FAILED',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              errorMessage: e.message,
            }
          );

          MediaRequest.sendNotification(
            entity,
            media,
            Notification.MEDIA_FAILED
          );
        }
      }
    }
  }

  public async sendToLidarr(entity: MediaRequest): Promise<void> {
    if (
      entity.status !== MediaRequestStatus.APPROVED ||
      entity.type !== MediaType.MUSIC
    ) {
      return;
    }

    try {
      const mediaRepository = getRepository(Media);
      const settings = getSettings();

      let lidarrSettings = settings.lidarr.find((lidarr) => lidarr.isDefault);

      if (
        entity.serverId !== null &&
        entity.serverId >= 0 &&
        lidarrSettings?.id !== entity.serverId
      ) {
        lidarrSettings = settings.lidarr.find(
          (lidarr) => lidarr.id === entity.serverId
        );
      }

      if (!lidarrSettings) {
        logger.warn('There is no default Lidarr server configured.', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
        return;
      }

      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });

      if (!media?.mbId) {
        logger.error('Music media data not found or missing mbId', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
        return;
      }

      if (media.status === MediaStatus.AVAILABLE) {
        logger.warn('Music already exists, marking request as COMPLETED', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });

        const requestRepository = getRepository(MediaRequest);
        entity.status = MediaRequestStatus.COMPLETED;
        await requestRepository.save(entity);
        return;
      }

      const lidarr = new LidarrAPI({
        apiKey: lidarrSettings.apiKey,
        url: LidarrAPI.buildUrl(lidarrSettings, '/api/v1'),
      });

      const searchResults = await lidarr.searchAlbumByMusicBrainzId(media.mbId);

      if (!searchResults?.length) {
        throw new Error('Album not found in Lidarr search');
      }

      const albumInfo = searchResults[0].album;
      const rootFolder = entity.rootFolder || lidarrSettings.activeDirectory;
      const qualityProfile = entity.profileId || lidarrSettings.activeProfileId;
      const metadataProfile =
        entity.metadataProfileId ?? lidarrSettings.activeMetadataProfileId ?? 1;
      const tags = entity.tags ? [...entity.tags] : [...(lidarrSettings.tags ?? [])];

      if (lidarrSettings.tagRequests) {
        let userTag = (await lidarr.getTags()).find((tag) =>
          tag.label.startsWith(`${entity.requestedBy.id} - `)
        );

        if (!userTag) {
          userTag = await lidarr.createTag({
            label: `${entity.requestedBy.id} - ${entity.requestedBy.displayName}`,
          });
        }

        if (userTag.id && !tags.includes(userTag.id)) {
          tags.push(userTag.id);
        }
      }

      const artistPath = `${rootFolder}/${albumInfo.artist.artistName}`;
      const addAlbumPayload: LidarrAlbumOptions = {
        title: albumInfo.title,
        disambiguation: albumInfo.disambiguation || '',
        overview: albumInfo.overview,
        artistId: albumInfo.artist.id,
        foreignAlbumId: albumInfo.foreignAlbumId,
        monitored: true,
        anyReleaseOk: true,
        profileId: qualityProfile,
        duration: albumInfo.duration || 0,
        albumType: albumInfo.albumType,
        secondaryTypes: [],
        mediumCount: albumInfo.mediumCount || 0,
        ratings: albumInfo.ratings,
        releaseDate: albumInfo.releaseDate,
        releases: [],
        genres: albumInfo.genres,
        media: [],
        artist: {
          status: albumInfo.artist.status,
          ended: albumInfo.artist.ended,
          artistName: albumInfo.artist.artistName,
          foreignArtistId: albumInfo.artist.foreignArtistId,
          tadbId: albumInfo.artist.tadbId || 0,
          discogsId: albumInfo.artist.discogsId || 0,
          overview: albumInfo.artist.overview,
          artistType: albumInfo.artist.artistType,
          disambiguation: albumInfo.artist.disambiguation,
          links: albumInfo.artist.links || [],
          images: albumInfo.artist.images || [],
          path: artistPath,
          qualityProfileId: qualityProfile,
          metadataProfileId: metadataProfile,
          monitored: true,
          monitorNewItems: 'none',
          rootFolderPath: rootFolder,
          genres: albumInfo.artist.genres || [],
          cleanName: albumInfo.artist.cleanName,
          sortName: albumInfo.artist.sortName,
          tags,
          added: albumInfo.artist.added || new Date().toISOString(),
          ratings: albumInfo.artist.ratings,
          id: albumInfo.artist.id,
        },
        images: albumInfo.images || [],
        links: albumInfo.links || [],
        addOptions: {
          searchForNewAlbum: true,
        },
      };

      const result = await lidarr.addAlbum(addAlbumPayload);

      media.externalServiceId = result.id;
      media.externalServiceSlug = result.titleSlug;
      media.serviceId = lidarrSettings.id;
      await mediaRepository.save(media);

      const requestRepository = getRepository(MediaRequest);
      entity.status = MediaRequestStatus.COMPLETED;
      await requestRepository.save(entity);

      logger.info('Sent request to Lidarr', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
      });
    } catch (e) {
      const requestRepository = getRepository(MediaRequest);
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });

      entity.status = MediaRequestStatus.FAILED;
      await requestRepository.save(entity);

      logger.warn('Something went wrong sending album request to Lidarr', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });

      if (media) {
        MediaRequest.sendNotification(entity, media, Notification.MEDIA_FAILED);
      }
    }
  }

  public async sendToReadarr(entity: MediaRequest): Promise<void> {
    if (
      entity.status !== MediaRequestStatus.APPROVED ||
      entity.type !== MediaType.BOOK
    ) {
      return;
    }

    try {
      const mediaRepository = getRepository(Media);
      const settings = getSettings();

      let readarrSettings = settings.readarr.find(
        (readarr) => readarr.isDefault
      );

      if (
        entity.serverId !== null &&
        entity.serverId >= 0 &&
        readarrSettings?.id !== entity.serverId
      ) {
        readarrSettings = settings.readarr.find(
          (readarr) => readarr.id === entity.serverId
        );
      }

      if (!readarrSettings) {
        logger.warn('There is no default Readarr server configured.', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
        return;
      }

      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
        relations: { identifiers: true },
      });

      if (!media) {
        logger.error('Book media data not found', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
        return;
      }

      if (media.status === MediaStatus.AVAILABLE) {
        logger.warn('Book already exists, marking request as COMPLETED', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });

        const requestRepository = getRepository(MediaRequest);
        entity.status = MediaRequestStatus.COMPLETED;
        await requestRepository.save(entity);
        return;
      }

      const openLibraryId = media.identifiers?.find(
        (identifier) =>
          identifier.provider === MediaIdentifierProvider.OPENLIBRARY
      )?.value;
      const isbn = media.identifiers?.find(
        (identifier) => identifier.provider === MediaIdentifierProvider.ISBN
      )?.value;

      if (!openLibraryId && !isbn) {
        throw new Error('Book request is missing lookup identifiers');
      }

      const readarr = new ReadarrAPI({
        apiKey: readarrSettings.apiKey,
        url: ReadarrAPI.buildUrl(readarrSettings, '/api/v1'),
      });
      const openLibrary = new OpenLibraryAPI();
      const work = openLibraryId
        ? await openLibrary.getWork(openLibraryId)
        : undefined;
      const lookupTerms = [
        isbn,
        isbn ? `isbn:${isbn}` : undefined,
        work?.title,
      ].filter(
        (term, index, terms): term is string =>
          !!term && terms.indexOf(term) === index
      );

      if (!lookupTerms.length) {
        throw new Error('Book request is missing a Readarr lookup term');
      }

      let searchResults: ReadarrBookLookupResult[] = [];
      let lookupTerm: string | undefined;

      for (const term of lookupTerms) {
        lookupTerm = term;
        searchResults = await readarr.lookupBook(term);

        if (searchResults?.length) {
          break;
        }
      }

      if (!searchResults?.length) {
        throw new Error(
          `Book not found in Readarr search for ${lookupTerms.join(', ')}`
        );
      }

      const normalizedIsbn = isbn?.replace(/[^0-9X]/gi, '').toUpperCase();
      const bookInfo =
        searchResults.find((result) =>
          result.editions?.some(
            (edition) =>
              edition.isbn13?.replace(/[^0-9X]/gi, '').toUpperCase() ===
              normalizedIsbn
          )
        ) ?? searchResults[0];
      const rootFolder = entity.rootFolder || readarrSettings.activeDirectory;
      const qualityProfile =
        entity.profileId || readarrSettings.activeProfileId;
      const metadataProfile =
        entity.metadataProfileId ?? readarrSettings.activeMetadataProfileId ?? 1;
      const tags = entity.tags
        ? [...entity.tags]
        : [...(readarrSettings.tags ?? [])];

      const result = await readarr.addBook({
        ...bookInfo,
        monitored: true,
        qualityProfileId: qualityProfile,
        metadataProfileId: metadataProfile,
        rootFolderPath: rootFolder,
        tags,
        addOptions: {
          searchForNewBook: true,
        },
      });

      media.externalServiceId = result.id ?? null;
      media.externalServiceSlug = result.titleSlug ?? result.foreignBookId;
      media.serviceId = readarrSettings.id;
      await mediaRepository.save(media);

      const identifierRepository = getRepository(MediaIdentifier);
      const existingIdentifierKeys = new Set(
        (media.identifiers ?? []).map(
          (identifier) => `${identifier.provider}:${identifier.value}`
        )
      );
      const identifiersToSave = [
        result.foreignBookId
          ? {
              provider: MediaIdentifierProvider.READARR,
              value: result.foreignBookId,
            }
          : undefined,
        result.editions?.find((edition) => edition.isbn13)?.isbn13
          ? {
              provider: MediaIdentifierProvider.ISBN,
              value: result.editions.find((edition) => edition.isbn13)?.isbn13,
            }
          : undefined,
      ].filter(
        (
          identifier
        ): identifier is {
          provider: MediaIdentifierProvider;
          value: string;
        } =>
          !!identifier &&
          !existingIdentifierKeys.has(
            `${identifier.provider}:${identifier.value}`
          )
      );

      if (identifiersToSave.length) {
        await identifierRepository.save(
          identifiersToSave.map(
            (identifier) =>
              new MediaIdentifier({
                media,
                provider: identifier.provider,
                value: identifier.value,
                canonical: false,
              })
          )
        );
      }

      const requestRepository = getRepository(MediaRequest);
      entity.status = MediaRequestStatus.COMPLETED;
      await requestRepository.save(entity);

      logger.info('Sent request to Readarr', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        lookupTerm,
      });
    } catch (e) {
      const requestRepository = getRepository(MediaRequest);
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });

      entity.status = MediaRequestStatus.FAILED;
      await requestRepository.save(entity);

      logger.warn('Something went wrong sending book request to Readarr', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });

      if (media) {
        MediaRequest.sendNotification(entity, media, Notification.MEDIA_FAILED);
      }
    }
  }

  public async updateParentStatus(entity: MediaRequest): Promise<void> {
    const mediaRepository = getRepository(Media);
    const media = await mediaRepository.findOne({
      where: { id: entity.media.id },
    });
    if (!media) {
      logger.error('Media data not found', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
      });
      return;
    }

    const statusKey = entity.is4k ? 'status4k' : 'status';
    const seasonRequestRepository = getRepository(SeasonRequest);
    const requestRepository = getRepository(MediaRequest);

    if (
      entity.status === MediaRequestStatus.APPROVED &&
      // Do not update the status if the item is already partially available or available
      media[statusKey] !== MediaStatus.AVAILABLE &&
      media[statusKey] !== MediaStatus.PARTIALLY_AVAILABLE &&
      media[statusKey] !== MediaStatus.PROCESSING
    ) {
      media[statusKey] = MediaStatus.PROCESSING;
      await mediaRepository.save(media);
    }

    if (
      media.mediaType === MediaType.MOVIE &&
      entity.status === MediaRequestStatus.DECLINED &&
      media[statusKey] !== MediaStatus.DELETED
    ) {
      media[statusKey] = MediaStatus.UNKNOWN;
      await mediaRepository.save(media);
    }

    /**
     * If the media type is TV, and we are declining a request,
     * we must check if its the only pending request and that
     * there the current media status is just pending (meaning no
     * other requests have yet to be approved)
     */
    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.DECLINED &&
      media[statusKey] === MediaStatus.PENDING
    ) {
      const pendingCount = await requestRepository.count({
        where: {
          media: { id: media.id },
          status: MediaRequestStatus.PENDING,
          is4k: entity.is4k,
          id: Not(entity.id),
        },
      });

      if (pendingCount === 0) {
        // Re-fetch media without requests to avoid cascade issues
        const freshMedia = await mediaRepository.findOne({
          where: { id: media.id },
        });
        if (freshMedia) {
          freshMedia[statusKey] = MediaStatus.UNKNOWN;
          await mediaRepository.save(freshMedia);
        }
      }
    }

    // Reset season statuses when a TV request is declined
    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.DECLINED
    ) {
      const seasonRepository = getRepository(Season);
      const actualSeasons = await seasonRepository.find({
        where: { media: { id: media.id } },
      });

      for (const seasonRequest of entity.seasons) {
        seasonRequest.status = MediaRequestStatus.DECLINED;
        await seasonRequestRepository.save(seasonRequest);

        const season = actualSeasons.find(
          (s) => s.seasonNumber === seasonRequest.seasonNumber
        );

        if (season && season[statusKey] === MediaStatus.PENDING) {
          const otherActiveRequests = await requestRepository
            .createQueryBuilder('request')
            .leftJoinAndSelect('request.seasons', 'season')
            .where('request.mediaId = :mediaId', { mediaId: media.id })
            .andWhere('request.id != :requestId', { requestId: entity.id })
            .andWhere('request.is4k = :is4k', { is4k: entity.is4k })
            .andWhere('request.status NOT IN (:...statuses)', {
              statuses: [
                MediaRequestStatus.DECLINED,
                MediaRequestStatus.COMPLETED,
              ],
            })
            .andWhere('season.seasonNumber = :seasonNumber', {
              seasonNumber: season.seasonNumber,
            })
            .getCount();

          if (otherActiveRequests === 0) {
            season[statusKey] = MediaStatus.UNKNOWN;
            await seasonRepository.save(season);
          }
        }
      }
    }

    // Approve child seasons if parent is approved
    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.APPROVED
    ) {
      for (const season of entity.seasons) {
        season.status = MediaRequestStatus.APPROVED;
        await seasonRequestRepository.save(season);
      }
    }
  }

  public async handleRemoveParentUpdate(
    manager: EntityManager,
    entity: MediaRequest
  ): Promise<void> {
    const fullMedia = await manager.findOneOrFail(Media, {
      where: { id: entity.media.id },
      relations: { requests: true },
    });

    const needsStatusUpdate =
      !fullMedia.requests.some((request) => !request.is4k) &&
      fullMedia.status !== MediaStatus.AVAILABLE;

    const needs4kStatusUpdate =
      !fullMedia.requests.some((request) => request.is4k) &&
      fullMedia.status4k !== MediaStatus.AVAILABLE;

    if (needsStatusUpdate || needs4kStatusUpdate) {
      // Re-fetch WITHOUT requests to avoid cascade issues on save
      const cleanMedia = await manager.findOneOrFail(Media, {
        where: { id: entity.media.id },
      });

      if (needsStatusUpdate) {
        cleanMedia.status = MediaStatus.UNKNOWN;
      }
      if (needs4kStatusUpdate) {
        cleanMedia.status4k = MediaStatus.UNKNOWN;
      }

      await manager.save(cleanMedia);
    }
  }

  public async afterUpdate(event: UpdateEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    try {
      await this.sendToRadarr(event.entity as MediaRequest);
      await this.sendToSonarr(event.entity as MediaRequest);
      await this.sendToLidarr(event.entity as MediaRequest);
      await this.sendToReadarr(event.entity as MediaRequest);
    } catch (e) {
      logger.error('Error while sending to *arr in afterUpdate subscriber', {
        label: 'Media Request',
        requestId: (event.entity as MediaRequest).id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      await this.updateParentStatus(event.entity as MediaRequest);

      if (event.entity.status === MediaRequestStatus.COMPLETED) {
        if (event.entity.media.mediaType === MediaType.MOVIE) {
          await this.notifyAvailableMovie(event.entity as MediaRequest, event);
        }
        if (event.entity.media.mediaType === MediaType.TV) {
          await this.notifyAvailableSeries(event.entity as MediaRequest, event);
        }
        if (event.entity.media.mediaType === MediaType.MUSIC) {
          await this.notifyAvailableMusic(event.entity as MediaRequest, event);
        }
        if (event.entity.media.mediaType === MediaType.BOOK) {
          await this.notifyAvailableBook(event.entity as MediaRequest, event);
        }
      }
    } catch (e) {
      logger.error(
        'Error while updating parent status in afterUpdate subscriber',
        {
          label: 'Media Request',
          requestId: (event.entity as MediaRequest).id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }
  }

  public async afterInsert(event: InsertEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    try {
      await this.sendToRadarr(event.entity as MediaRequest);
      await this.sendToSonarr(event.entity as MediaRequest);
      await this.sendToLidarr(event.entity as MediaRequest);
      await this.sendToReadarr(event.entity as MediaRequest);
    } catch (e) {
      logger.error('Error while sending to *arr in afterInsert subscriber', {
        label: 'Media Request',
        requestId: (event.entity as MediaRequest).id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      await this.updateParentStatus(event.entity as MediaRequest);
    } catch (e) {
      logger.error(
        'Error while updating parent status in afterInsert subscriber',
        {
          label: 'Media Request',
          requestId: (event.entity as MediaRequest).id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }
  }

  public async afterRemove(event: RemoveEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    await this.handleRemoveParentUpdate(
      event.manager as EntityManager,
      event.entity as MediaRequest
    );
  }

  public listenTo(): typeof MediaRequest {
    return MediaRequest;
  }
}
