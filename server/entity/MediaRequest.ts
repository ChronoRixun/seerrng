import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import type { TmdbKeyword } from '@server/api/themoviedb/interfaces';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import OverrideRule from '@server/entity/OverrideRule';
import type { MediaRequestBody } from '@server/interfaces/api/requestInterfaces';
import notificationManager, { Notification } from '@server/lib/notifications';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import { truncate } from 'lodash';
import {
  AfterInsert,
  AfterLoad,
  AfterUpdate,
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  RelationCount,
  UpdateDateColumn,
} from 'typeorm';
import Media from './Media';
import SeasonRequest from './SeasonRequest';
import { User } from './User';

export class RequestPermissionError extends Error {}
export class QuotaRestrictedError extends Error {}
export class DuplicateMediaRequestError extends Error {}
export class NoSeasonsAvailableError extends Error {}
export class BlocklistedMediaError extends Error {}

type MediaRequestOptions = {
  isAutoRequest?: boolean;
};

@Entity()
export class MediaRequest {
  public static async request(
    requestBody: MediaRequestBody,
    user: User,
    options: MediaRequestOptions = {}
  ): Promise<MediaRequest> {
    const tmdb = new TheMovieDb();
    const listenbrainz = new ListenBrainzAPI();
    const openLibrary = new OpenLibraryAPI();
    const mediaRepository = getRepository(Media);
    const mediaIdentifierRepository = getRepository(MediaIdentifier);
    const requestRepository = getRepository(MediaRequest);
    const userRepository = getRepository(User);
    const settings = getSettings();

    let requestUser = user;

    if (
      requestBody.userId &&
      !requestUser.hasPermission([
        Permission.MANAGE_USERS,
        Permission.MANAGE_REQUESTS,
      ])
    ) {
      throw new RequestPermissionError(
        'You do not have permission to modify the request user.'
      );
    } else if (requestBody.userId) {
      requestUser = await userRepository.findOneOrFail({
        where: { id: requestBody.userId },
      });
    }

    if (!requestUser) {
      throw new Error('User missing from request context.');
    }

    if (
      requestBody.mediaType === MediaType.MOVIE &&
      !requestUser.hasPermission(
        requestBody.is4k
          ? [Permission.REQUEST_4K, Permission.REQUEST_4K_MOVIE]
          : [Permission.REQUEST, Permission.REQUEST_MOVIE],
        {
          type: 'or',
        }
      )
    ) {
      throw new RequestPermissionError(
        `You do not have permission to make ${
          requestBody.is4k ? '4K ' : ''
        }movie requests.`
      );
    } else if (
      requestBody.mediaType === MediaType.TV &&
      !requestUser.hasPermission(
        requestBody.is4k
          ? [Permission.REQUEST_4K, Permission.REQUEST_4K_TV]
          : [Permission.REQUEST, Permission.REQUEST_TV],
        {
          type: 'or',
        }
      )
    ) {
      throw new RequestPermissionError(
        `You do not have permission to make ${
          requestBody.is4k ? '4K ' : ''
        }series requests.`
      );
    } else if (
      requestBody.mediaType === MediaType.MUSIC &&
      !requestUser.hasPermission([Permission.REQUEST, Permission.REQUEST_MUSIC], {
        type: 'or',
      })
    ) {
      throw new RequestPermissionError(
        'You do not have permission to make music requests.'
      );
    } else if (
      requestBody.mediaType === MediaType.BOOK &&
      !requestUser.hasPermission([Permission.REQUEST, Permission.REQUEST_BOOK], {
        type: 'or',
      })
    ) {
      throw new RequestPermissionError(
        'You do not have permission to make book requests.'
      );
    }

    const quotas = await requestUser.getQuota();

    if (requestBody.mediaType === MediaType.MOVIE && quotas.movie.restricted) {
      throw new QuotaRestrictedError('Movie Quota exceeded.');
    } else if (requestBody.mediaType === MediaType.TV && quotas.tv.restricted) {
      throw new QuotaRestrictedError('Series Quota exceeded.');
    } else if (
      requestBody.mediaType === MediaType.MUSIC &&
      quotas.music.restricted
    ) {
      throw new QuotaRestrictedError('Music Quota exceeded.');
    } else if (
      requestBody.mediaType === MediaType.BOOK &&
      quotas.book.restricted
    ) {
      throw new QuotaRestrictedError('Book Quota exceeded.');
    }

    if (requestBody.mediaType === MediaType.MUSIC) {
      const album = await listenbrainz.getAlbum(requestBody.mediaId.toString());
      const musicMbId = album.release_group_mbid;
      const blocklistedAlbum = await getRepository(Blocklist).findOne({
        where: {
          externalId: musicMbId,
          mediaType: MediaType.MUSIC,
        },
      });

      if (blocklistedAlbum) {
        logger.warn('Request for music blocked due to being blocklisted', {
          mbId: musicMbId,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This album is blocklisted.');
      }

      let media = await mediaRepository.findOne({
        where: { mbId: musicMbId, mediaType: MediaType.MUSIC },
        relations: ['requests'],
      });

      if (!media) {
        media = new Media({
          tmdbId: 0,
          mbId: musicMbId,
          status: MediaStatus.PENDING,
          status4k: MediaStatus.UNKNOWN,
          mediaType: MediaType.MUSIC,
        });
      } else if (media.status === MediaStatus.BLOCKLISTED) {
        logger.warn('Request for music blocked due to being blocklisted', {
          mbId: musicMbId,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This album is blocklisted.');
      } else if (media.status === MediaStatus.UNKNOWN) {
        media.status = MediaStatus.PENDING;
      }

      const existing = await requestRepository
        .createQueryBuilder('request')
        .leftJoin('request.media', 'media')
        .leftJoinAndSelect('request.requestedBy', 'user')
        .where('media.mbId = :mbId', { mbId: musicMbId })
        .andWhere('media.mediaType = :mediaType', {
          mediaType: MediaType.MUSIC,
        })
        .getMany();

      if (
        existing.some(
          (request) =>
            request.status !== MediaRequestStatus.DECLINED &&
            request.status !== MediaRequestStatus.COMPLETED
        )
      ) {
        throw new DuplicateMediaRequestError(
          'Request for this album already exists.'
        );
      }

      const useOverrides = !user.hasPermission([Permission.MANAGE_REQUESTS], {
        type: 'or',
      });

      const defaultLidarr = settings.lidarr.find((lidarr) => lidarr.isDefault);
      const serverId = requestBody.serverId ?? defaultLidarr?.id;
      let rootFolder = requestBody.rootFolder ?? defaultLidarr?.activeDirectory;
      let profileId = requestBody.profileId ?? defaultLidarr?.activeProfileId;
      const metadataProfileId =
        requestBody.metadataProfileId ?? defaultLidarr?.activeMetadataProfileId;
      let tags = requestBody.tags ?? defaultLidarr?.tags;

      if (useOverrides) {
        const overrideRules = await getRepository(OverrideRule).find({
          where: { lidarrServiceId: serverId },
        });
        const prioritizedRule = overrideRules.find(
          (rule) =>
            !rule.users ||
            rule.users
              .split(',')
              .some((userId) => Number(userId) === requestUser.id)
        );

        if (prioritizedRule?.rootFolder) {
          rootFolder = prioritizedRule.rootFolder;
        }
        if (prioritizedRule?.profileId) {
          profileId = prioritizedRule.profileId;
        }
        if (prioritizedRule?.tags) {
          tags = [
            ...new Set([
              ...(tags || []),
              ...prioritizedRule.tags.split(',').map((tag) => Number(tag)),
            ]),
          ];
        }
      }

      await mediaRepository.save(media);

      const autoApproved = user.hasPermission(
        [
          Permission.AUTO_APPROVE,
          Permission.AUTO_APPROVE_MUSIC,
          Permission.MANAGE_REQUESTS,
        ],
        { type: 'or' }
      );

      const request = new MediaRequest({
        type: MediaType.MUSIC,
        media,
        requestedBy: requestUser,
        status: autoApproved
          ? MediaRequestStatus.APPROVED
          : MediaRequestStatus.PENDING,
        modifiedBy: autoApproved ? user : undefined,
        is4k: false,
        serverId,
        profileId,
        metadataProfileId,
        rootFolder,
        tags,
        isAutoRequest: options.isAutoRequest ?? false,
      });

      await requestRepository.save(request);
      return request;
    }

    if (requestBody.mediaType === MediaType.BOOK) {
      const openLibraryId = requestBody.mediaId
        .toString()
        .replace(/^\/?works\//, '');
      const [, editions] = await Promise.all([
        openLibrary.getWork(openLibraryId),
        openLibrary.getWorkEditions(openLibraryId).catch(() => ({
          size: 0,
          entries: [],
        })),
      ]);
      const normalizedRequestIsbn = requestBody.isbn13
        ?.replace(/[^0-9X]/gi, '')
        .toUpperCase();
      const requestIsbn = (
        normalizedRequestIsbn ??
        editions.entries.find((edition) => edition.isbn_13?.[0])?.isbn_13?.[0] ??
        editions.entries.find((edition) => edition.isbn_10?.[0])?.isbn_10?.[0]
      )?.replace(/[^0-9X]/gi, '').toUpperCase();
      const openLibraryEditionId = requestBody.editionId
        ?.toString()
        .replace(/^\/?books\//, '');
      const identifierCandidates = [
        {
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: openLibraryId,
          canonical: true,
        },
        ...(requestIsbn
          ? [
              {
                provider: MediaIdentifierProvider.ISBN,
                value: requestIsbn,
                canonical: false,
              },
            ]
          : []),
        ...(openLibraryEditionId
          ? [
              {
                provider: MediaIdentifierProvider.OPENLIBRARY_EDITION,
                value: openLibraryEditionId,
                canonical: false,
              },
            ]
          : []),
      ];
      const blocklistedBook = await getRepository(Blocklist).findOne({
        where: [
          {
            externalId: openLibraryId,
            mediaType: MediaType.BOOK,
          },
          ...(openLibraryEditionId
            ? [
                {
                  externalId: openLibraryEditionId,
                  mediaType: MediaType.BOOK,
                },
              ]
            : []),
          ...(requestIsbn
            ? [
                {
                  externalId: requestIsbn,
                  mediaType: MediaType.BOOK,
                },
              ]
            : []),
        ],
      });

      if (blocklistedBook) {
        logger.warn('Request for book blocked due to being blocklisted', {
          openLibraryId,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This book is blocklisted.');
      }

      const existingIdentifier = await mediaIdentifierRepository.findOne({
        where: identifierCandidates.map((identifier) => ({
          provider: identifier.provider,
          value: identifier.value,
        })),
        relations: {
          media: {
            requests: true,
            identifiers: true,
          },
        },
      });

      let media = existingIdentifier?.media;

      if (!media) {
        media = new Media({
          tmdbId: 0,
          status: MediaStatus.PENDING,
          status4k: MediaStatus.UNKNOWN,
          mediaType: MediaType.BOOK,
          identifiers: identifierCandidates.map(
            (identifier) =>
              new MediaIdentifier({
                provider: identifier.provider,
                value: identifier.value,
                canonical: identifier.canonical,
              })
          ),
        });
      } else if (media.status === MediaStatus.BLOCKLISTED) {
        logger.warn('Request for book blocked due to being blocklisted', {
          openLibraryId,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This book is blocklisted.');
      } else if (media.status === MediaStatus.UNKNOWN) {
        media.status = MediaStatus.PENDING;
      }

      if (
        media?.requests?.some(
          (request) =>
            request.status !== MediaRequestStatus.DECLINED &&
            request.status !== MediaRequestStatus.COMPLETED
        )
      ) {
        throw new DuplicateMediaRequestError(
          'Request for this book already exists.'
        );
      }

      media = await mediaRepository.save(media);

      for (const identifier of identifierCandidates) {
        const hasIdentifier = media.identifiers?.some(
          (existing) =>
            existing.provider === identifier.provider &&
            existing.value === identifier.value
        );

        if (!hasIdentifier) {
          await mediaIdentifierRepository.save(
            new MediaIdentifier({
              media,
              provider: identifier.provider,
              value: identifier.value,
              canonical: identifier.canonical,
            })
          );
        }
      }

      if (normalizedRequestIsbn && normalizedRequestIsbn !== requestIsbn) {
        const hasRequestIsbn = media.identifiers?.some(
          (identifier) =>
            identifier.provider === MediaIdentifierProvider.ISBN &&
            identifier.value === normalizedRequestIsbn
        );

        if (!hasRequestIsbn) {
          await mediaIdentifierRepository.save(
            new MediaIdentifier({
              media,
              provider: MediaIdentifierProvider.ISBN,
              value: normalizedRequestIsbn,
              canonical: false,
            })
          );
        }
      }

      const defaultReadarr = settings.readarr.find(
        (readarr) => readarr.isDefault
      );
      const autoApproved = user.hasPermission(
        [
          Permission.AUTO_APPROVE,
          Permission.AUTO_APPROVE_BOOK,
          Permission.MANAGE_REQUESTS,
        ],
        { type: 'or' }
      );

      const request = new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy: requestUser,
        status: autoApproved
          ? MediaRequestStatus.APPROVED
          : MediaRequestStatus.PENDING,
        modifiedBy: autoApproved ? user : undefined,
        is4k: false,
        serverId: requestBody.serverId ?? defaultReadarr?.id,
        profileId: requestBody.profileId ?? defaultReadarr?.activeProfileId,
        metadataProfileId:
          requestBody.metadataProfileId ?? defaultReadarr?.activeMetadataProfileId,
        rootFolder: requestBody.rootFolder ?? defaultReadarr?.activeDirectory,
        tags: requestBody.tags ?? defaultReadarr?.tags,
        bookFormat: requestBody.format ?? 'ebook',
        isAutoRequest: options.isAutoRequest ?? false,
      });

      await requestRepository.save(request);
      return request;
    }

    const tmdbMedia =
      requestBody.mediaType === MediaType.MOVIE
        ? await tmdb.getMovie({ movieId: requestBody.mediaId as number })
        : await tmdb.getTvShow({ tvId: requestBody.mediaId as number });

    let media = await mediaRepository.findOne({
      where: {
        tmdbId: requestBody.mediaId as number,
        mediaType: requestBody.mediaType,
      },
      relations: ['requests'],
    });

    if (!media) {
      media = new Media({
        tmdbId: tmdbMedia.id,
        tvdbId: requestBody.tvdbId ?? tmdbMedia.external_ids.tvdb_id,
        status: !requestBody.is4k ? MediaStatus.PENDING : MediaStatus.UNKNOWN,
        status4k: requestBody.is4k ? MediaStatus.PENDING : MediaStatus.UNKNOWN,
        mediaType: requestBody.mediaType,
      });
    } else {
      if (media.status === MediaStatus.BLOCKLISTED) {
        logger.warn('Request for media blocked due to being blocklisted', {
          tmdbId: tmdbMedia.id,
          mediaType: requestBody.mediaType,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This media is blocklisted.');
      }

      if (media.status === MediaStatus.UNKNOWN && !requestBody.is4k) {
        media.status = MediaStatus.PENDING;
      }

      if (media.status4k === MediaStatus.UNKNOWN && requestBody.is4k) {
        media.status4k = MediaStatus.PENDING;
      }
    }

    const existing = await requestRepository
      .createQueryBuilder('request')
      .leftJoin('request.media', 'media')
      .leftJoinAndSelect('request.requestedBy', 'user')
      .where('request.is4k = :is4k', { is4k: requestBody.is4k })
      .andWhere('media.tmdbId = :tmdbId', { tmdbId: tmdbMedia.id })
      .andWhere('media.mediaType = :mediaType', {
        mediaType: requestBody.mediaType,
      })
      .getMany();

    if (existing && existing.length > 0) {
      // If there is an existing movie request that isn't declined, don't allow a new one.
      if (
        requestBody.mediaType === MediaType.MOVIE &&
        existing[0].status !== MediaRequestStatus.DECLINED &&
        existing[0].status !== MediaRequestStatus.COMPLETED
      ) {
        logger.warn('Duplicate request for media blocked', {
          tmdbId: tmdbMedia.id,
          mediaType: requestBody.mediaType,
          is4k: requestBody.is4k,
          label: 'Media Request',
        });

        throw new DuplicateMediaRequestError(
          'Request for this media already exists.'
        );
      }

      // If an existing auto-request for this media exists from the same user,
      // don't allow a new one.
      if (
        existing.find(
          (r) => r.requestedBy.id === requestUser.id && r.isAutoRequest
        )
      ) {
        throw new DuplicateMediaRequestError(
          'Auto-request for this media and user already exists.'
        );
      }
    }

    // Apply overrides if the user is not an admin or has the "advanced request" permission
    const useOverrides = !user.hasPermission([Permission.MANAGE_REQUESTS], {
      type: 'or',
    });

    let rootFolder = requestBody.rootFolder;
    let profileId = requestBody.profileId;
    let tags = requestBody.tags;

    if (useOverrides) {
      const defaultRadarrId = requestBody.is4k
        ? settings.radarr.findIndex((r) => r.is4k && r.isDefault)
        : settings.radarr.findIndex((r) => !r.is4k && r.isDefault);
      const defaultSonarrId = requestBody.is4k
        ? settings.sonarr.findIndex((s) => s.is4k && s.isDefault)
        : settings.sonarr.findIndex((s) => !s.is4k && s.isDefault);
      const overrideRuleRepository = getRepository(OverrideRule);
      const overrideRules = await overrideRuleRepository.find({
        where:
          requestBody.mediaType === MediaType.MOVIE
            ? { radarrServiceId: defaultRadarrId }
            : { sonarrServiceId: defaultSonarrId },
      });

      const appliedOverrideRules = overrideRules.filter((rule) => {
        const hasAnimeKeyword =
          'results' in tmdbMedia.keywords &&
          tmdbMedia.keywords.results.some(
            (keyword: TmdbKeyword) => keyword.id === ANIME_KEYWORD_ID
          );

        // Skip override rules if the media is an anime TV show as anime TV
        // is handled by default and override rules do not explicitly include
        // the anime keyword
        if (
          requestBody.mediaType === MediaType.TV &&
          hasAnimeKeyword &&
          (!rule.keywords ||
            !rule.keywords.split(',').map(Number).includes(ANIME_KEYWORD_ID))
        ) {
          return false;
        }

        if (
          rule.users &&
          !rule.users
            .split(',')
            .some((userId) => Number(userId) === requestUser.id)
        ) {
          return false;
        }
        if (
          rule.genre &&
          !rule.genre
            .split(',')
            .some((genreId) =>
              tmdbMedia.genres
                .map((genre) => genre.id)
                .includes(Number(genreId))
            )
        ) {
          return false;
        }
        if (
          rule.language &&
          !rule.language
            .split('|')
            .some((languageId) => languageId === tmdbMedia.original_language)
        ) {
          return false;
        }
        if (
          rule.keywords &&
          !rule.keywords.split(',').some((keywordId) => {
            let keywordList: TmdbKeyword[] = [];

            if ('keywords' in tmdbMedia.keywords) {
              keywordList = tmdbMedia.keywords.keywords;
            } else if ('results' in tmdbMedia.keywords) {
              keywordList = tmdbMedia.keywords.results;
            }

            return keywordList
              .map((keyword: TmdbKeyword) => keyword.id)
              .includes(Number(keywordId));
          })
        ) {
          return false;
        }
        return true;
      });

      // hacky way to prioritize rules
      // TODO: make this better
      const prioritizedRule = appliedOverrideRules.sort((a, b) => {
        const keys: (keyof OverrideRule)[] = ['genre', 'language', 'keywords'];

        const aSpecificity = keys.filter((key) => a[key] !== null).length;
        const bSpecificity = keys.filter((key) => b[key] !== null).length;

        // Take the rule with the most specific condition first
        return bSpecificity - aSpecificity;
      })[0];

      if (prioritizedRule) {
        if (prioritizedRule.rootFolder) {
          rootFolder = prioritizedRule.rootFolder;
        }
        if (prioritizedRule.profileId) {
          profileId = prioritizedRule.profileId;
        }
        if (prioritizedRule.tags) {
          tags = [
            ...new Set([
              ...(tags || []),
              ...prioritizedRule.tags.split(',').map((tag) => Number(tag)),
            ]),
          ];
        }

        logger.debug('Override rule applied.', {
          label: 'Media Request',
          overrides: prioritizedRule,
        });
      }
    }

    if (requestBody.mediaType === MediaType.MOVIE) {
      await mediaRepository.save(media);

      const request = new MediaRequest({
        type: MediaType.MOVIE,
        media,
        requestedBy: requestUser,
        // If the user is an admin or has the "auto approve" permission, automatically approve the request
        status: user.hasPermission(
          [
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K
              : Permission.AUTO_APPROVE,
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K_MOVIE
              : Permission.AUTO_APPROVE_MOVIE,
            Permission.MANAGE_REQUESTS,
          ],
          { type: 'or' }
        )
          ? MediaRequestStatus.APPROVED
          : MediaRequestStatus.PENDING,
        modifiedBy: user.hasPermission(
          [
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K
              : Permission.AUTO_APPROVE,
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K_MOVIE
              : Permission.AUTO_APPROVE_MOVIE,
            Permission.MANAGE_REQUESTS,
          ],
          { type: 'or' }
        )
          ? user
          : undefined,
        is4k: requestBody.is4k,
        serverId: requestBody.serverId,
        profileId: profileId,
        rootFolder: rootFolder,
        tags: tags,
        isAutoRequest: options.isAutoRequest ?? false,
      });

      await requestRepository.save(request);
      return request;
    } else {
      const tmdbMediaShow = tmdbMedia as Awaited<
        ReturnType<typeof tmdb.getTvShow>
      >;
      let requestedSeasons =
        requestBody.seasons === 'all'
          ? tmdbMediaShow.seasons
              .filter((season) => season.season_number !== 0)
              .map((season) => season.season_number)
          : (requestBody.seasons as number[]);
      if (!settings.main.enableSpecialEpisodes) {
        requestedSeasons = requestedSeasons.filter((sn) => sn > 0);
      }

      let existingSeasons: number[] = [];

      // We need to check existing requests on this title to make sure we don't double up on seasons that were
      // already requested. In the case they were, we just throw out any duplicates but still approve the request.
      // (Unless there are no seasons, in which case we abort)
      if (media.requests) {
        existingSeasons = media.requests
          .filter(
            (request) =>
              request.is4k === requestBody.is4k &&
              request.status !== MediaRequestStatus.DECLINED &&
              request.status !== MediaRequestStatus.COMPLETED
          )
          .reduce((seasons, request) => {
            const combinedSeasons = request.seasons.map(
              (season) => season.seasonNumber
            );

            return [...seasons, ...combinedSeasons];
          }, [] as number[]);
      }

      // We should also check seasons that are available/partially available but don't have existing requests
      if (media.seasons) {
        existingSeasons = [
          ...existingSeasons,
          ...media.seasons
            .filter(
              (season) =>
                season[requestBody.is4k ? 'status4k' : 'status'] !==
                  MediaStatus.UNKNOWN &&
                season[requestBody.is4k ? 'status4k' : 'status'] !==
                  MediaStatus.DELETED
            )
            .map((season) => season.seasonNumber),
        ];
      }

      const finalSeasons = requestedSeasons.filter(
        (rs) => !existingSeasons.includes(rs)
      );

      if (finalSeasons.length === 0) {
        throw new NoSeasonsAvailableError('No seasons available to request');
      } else if (
        quotas.tv.limit &&
        finalSeasons.length > (quotas.tv.remaining ?? 0)
      ) {
        throw new QuotaRestrictedError('Series Quota exceeded.');
      }

      await mediaRepository.save(media);

      const request = new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy: requestUser,
        // If the user is an admin or has the "auto approve" permission, automatically approve the request
        status: user.hasPermission(
          [
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K
              : Permission.AUTO_APPROVE,
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K_TV
              : Permission.AUTO_APPROVE_TV,
            Permission.MANAGE_REQUESTS,
          ],
          { type: 'or' }
        )
          ? MediaRequestStatus.APPROVED
          : MediaRequestStatus.PENDING,
        modifiedBy: user.hasPermission(
          [
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K
              : Permission.AUTO_APPROVE,
            requestBody.is4k
              ? Permission.AUTO_APPROVE_4K_TV
              : Permission.AUTO_APPROVE_TV,
            Permission.MANAGE_REQUESTS,
          ],
          { type: 'or' }
        )
          ? user
          : undefined,
        is4k: requestBody.is4k,
        serverId: requestBody.serverId,
        profileId: profileId,
        rootFolder: rootFolder,
        languageProfileId: requestBody.languageProfileId,
        tags: tags,
        seasons: finalSeasons.map(
          (sn) =>
            new SeasonRequest({
              seasonNumber: sn,
              status: user.hasPermission(
                [
                  requestBody.is4k
                    ? Permission.AUTO_APPROVE_4K
                    : Permission.AUTO_APPROVE,
                  requestBody.is4k
                    ? Permission.AUTO_APPROVE_4K_TV
                    : Permission.AUTO_APPROVE_TV,
                  Permission.MANAGE_REQUESTS,
                ],
                { type: 'or' }
              )
                ? MediaRequestStatus.APPROVED
                : MediaRequestStatus.PENDING,
            })
        ),
        isAutoRequest: options.isAutoRequest ?? false,
      });

      await requestRepository.save(request);
      return request;
    }
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  @Index()
  public status: MediaRequestStatus;

  @ManyToOne(() => Media, (media) => media.requests, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @ManyToOne(() => User, (user) => user.requests, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public requestedBy: User;

  @ManyToOne(() => User, {
    nullable: true,
    eager: true,
    onDelete: 'SET NULL',
  })
  @Index()
  public modifiedBy?: User;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  @Column({ type: 'varchar' })
  public type: MediaType;

  @RelationCount((request: MediaRequest) => request.seasons)
  public seasonCount: number;

  @OneToMany(() => SeasonRequest, (season) => season.request, {
    eager: true,
    cascade: true,
  })
  public seasons: SeasonRequest[];

  @Column({ default: false })
  public is4k: boolean;

  @Column({ nullable: true })
  public serverId: number;

  @Column({ nullable: true })
  public profileId: number;

  @Column({ nullable: true })
  public rootFolder: string;

  @Column({ nullable: true })
  public languageProfileId: number;

  @Column({ nullable: true })
  public metadataProfileId: number;

  @Column({ nullable: true, type: 'varchar' })
  public bookFormat?: 'ebook' | 'audiobook' | 'both' | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      from: (value: string | null): number[] | null => {
        if (value) {
          if (value === 'none') {
            return [];
          }
          return value.split(',').map((v) => Number(v));
        }
        return null;
      },
      to: (value: number[] | null): string | null => {
        if (value) {
          const finalValue = value.join(',');

          // We want to keep the actual state of an "empty array" so we use
          // the keyword "none" to track this.
          if (!finalValue) {
            return 'none';
          }

          return finalValue;
        }
        return null;
      },
    },
  })
  public tags?: number[];

  @Column({ default: false })
  public isAutoRequest: boolean;

  constructor(init?: Partial<MediaRequest>) {
    Object.assign(this, init);
  }

  @AfterInsert()
  public async notifyNewRequest(): Promise<void> {
    if (this.status === MediaRequestStatus.PENDING) {
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: this.media.id },
      });
      if (!media) {
        logger.error('Media data not found', {
          label: 'Media Request',
          requestId: this.id,
          mediaId: this.media.id,
        });
        return;
      }

      MediaRequest.sendNotification(this, media, Notification.MEDIA_PENDING);

      if (this.isAutoRequest) {
        MediaRequest.sendNotification(
          this,
          media,
          Notification.MEDIA_AUTO_REQUESTED
        );
      }
    }
  }

  /**
   * Notification for approval
   *
   * We only check on AfterUpdate as to not trigger this for
   * auto approved content
   */
  @AfterUpdate()
  public async notifyApprovedOrDeclined(autoApproved = false): Promise<void> {
    if (
      this.status === MediaRequestStatus.APPROVED ||
      this.status === MediaRequestStatus.DECLINED
    ) {
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: this.media.id },
      });
      if (!media) {
        logger.error('Media data not found', {
          label: 'Media Request',
          requestId: this.id,
          mediaId: this.media.id,
        });
        return;
      }

      if (
        this.status === MediaRequestStatus.APPROVED &&
        media[this.is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE
      ) {
        logger.info(
          'Media is already available. Sending availability notification instead of approval.',
          { label: 'Media Request', requestId: this.id, mediaId: this.media.id }
        );
        MediaRequest.sendNotification(
          this,
          media,
          Notification.MEDIA_AVAILABLE
        );
        return;
      }

      MediaRequest.sendNotification(
        this,
        media,
        this.status === MediaRequestStatus.APPROVED
          ? autoApproved
            ? Notification.MEDIA_AUTO_APPROVED
            : Notification.MEDIA_APPROVED
          : Notification.MEDIA_DECLINED
      );

      if (
        this.status === MediaRequestStatus.APPROVED &&
        autoApproved &&
        this.isAutoRequest
      ) {
        MediaRequest.sendNotification(
          this,
          media,
          Notification.MEDIA_AUTO_REQUESTED
        );
      }
    }
  }

  @AfterInsert()
  public async autoapprovalNotification(): Promise<void> {
    if (this.status === MediaRequestStatus.APPROVED) {
      this.notifyApprovedOrDeclined(true);
    }
  }

  @AfterLoad()
  private sortSeasons() {
    if (Array.isArray(this.seasons)) {
      this.seasons.sort((a, b) => a.id - b.id);
    }
  }

  static async sendNotification(
    entity: MediaRequest,
    media: Media,
    type: Notification
  ) {
    const tmdb = new TheMovieDb();
    const listenbrainz = new ListenBrainzAPI();
    const openLibrary = new OpenLibraryAPI();

    try {
      const mediaType =
        entity.type === MediaType.MOVIE
          ? 'Movie'
          : entity.type === MediaType.TV
            ? 'Series'
            : entity.type === MediaType.MUSIC
              ? 'Music'
              : 'Book';
      let event: string | undefined;
      let notifyAdmin = true;
      let notifySystem = true;

      switch (type) {
        case Notification.MEDIA_AVAILABLE:
          event = `${entity.is4k ? '4K ' : ''}${mediaType} Now Available`;
          notifyAdmin = false;
          break;
        case Notification.MEDIA_APPROVED:
          event = `${entity.is4k ? '4K ' : ''}${mediaType} Request Approved`;
          notifyAdmin = false;
          break;
        case Notification.MEDIA_DECLINED:
          event = `${entity.is4k ? '4K ' : ''}${mediaType} Request Declined`;
          notifyAdmin = false;
          break;
        case Notification.MEDIA_PENDING:
          event = `New ${entity.is4k ? '4K ' : ''}${mediaType} Request`;
          break;
        case Notification.MEDIA_AUTO_REQUESTED:
          event = `${
            entity.is4k ? '4K ' : ''
          }${mediaType} Request Automatically Submitted`;
          notifyAdmin = false;
          notifySystem = false;
          break;
        case Notification.MEDIA_AUTO_APPROVED:
          event = `${
            entity.is4k ? '4K ' : ''
          }${mediaType} Request Automatically Approved`;
          break;
        case Notification.MEDIA_FAILED:
          event = `${entity.is4k ? '4K ' : ''}${mediaType} Request Failed`;
          break;
      }

      if (entity.type === MediaType.MOVIE) {
        const movie = await tmdb.getMovie({ movieId: media.tmdbId });
        notificationManager.sendNotification(type, {
          media,
          mediaUrl: `/movie/${media.tmdbId}`,
          request: entity,
          notifyAdmin,
          notifySystem,
          notifyUser: notifyAdmin ? undefined : entity.requestedBy,
          event,
          subject: `${movie.title}${
            movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
          }`,
          message: truncate(movie.overview, {
            length: 500,
            separator: /\s/,
            omission: '…',
          }),
          image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`,
        });
      } else if (entity.type === MediaType.TV) {
        const tv = await tmdb.getTvShow({ tvId: media.tmdbId });
        notificationManager.sendNotification(type, {
          media,
          mediaUrl: `/tv/${media.tmdbId}`,
          request: entity,
          notifyAdmin,
          notifySystem,
          notifyUser: notifyAdmin ? undefined : entity.requestedBy,
          event,
          subject: `${tv.name}${
            tv.first_air_date ? ` (${tv.first_air_date.slice(0, 4)})` : ''
          }`,
          message: truncate(tv.overview, {
            length: 500,
            separator: /\s/,
            omission: '…',
          }),
          image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tv.poster_path}`,
          extra: [
            {
              name: 'Requested Seasons',
              value: entity.seasons
                .map((season) => season.seasonNumber)
                .join(', '),
            },
          ],
        });
      } else if (entity.type === MediaType.MUSIC && media.mbId) {
        const album = await listenbrainz.getAlbum(media.mbId);
        const releaseGroup = album.release_group_metadata.release_group;
        const artist = album.release_group_metadata.artist;
        const releaseYear = releaseGroup.date?.slice(0, 4);

        notificationManager.sendNotification(type, {
          media,
          mediaUrl: `/music/${media.mbId}`,
          request: entity,
          notifyAdmin,
          notifySystem,
          notifyUser: notifyAdmin ? undefined : entity.requestedBy,
          event,
          subject: `${releaseGroup.name}${
            releaseYear ? ` (${releaseYear})` : ''
          }`,
          message: artist.name,
          extra: [
            {
              name: 'Artist',
              value: artist.name,
            },
          ],
        });
      } else if (entity.type === MediaType.BOOK) {
        const mediaWithIdentifiers =
          media.identifiers !== undefined
            ? media
            : await getRepository(Media).findOne({
                where: { id: media.id },
                relations: { identifiers: true },
              });
        const openLibraryId = mediaWithIdentifiers?.identifiers?.find(
          (identifier) =>
            identifier.provider === MediaIdentifierProvider.OPENLIBRARY
        )?.value;

        if (!openLibraryId) {
          throw new Error('Missing Open Library identifier for book request.');
        }

        const [work, editions] = await Promise.all([
          openLibrary.getWork(openLibraryId),
          openLibrary.getWorkEditions(openLibraryId).catch(() => ({
            size: 0,
            entries: [],
          })),
        ]);
        const description =
          typeof work.description === 'string'
            ? work.description
            : work.description?.value;
        const releaseYear = work.first_publish_date?.match(/\d{4}/)?.[0];
        const coverId = work.covers?.[0];
        const isbn =
          editions.entries.find((edition) => edition.isbn_13?.[0])?.isbn_13?.[0] ??
          editions.entries.find((edition) => edition.isbn_10?.[0])?.isbn_10?.[0];

        notificationManager.sendNotification(type, {
          media,
          mediaUrl: `/book/${openLibraryId}`,
          request: entity,
          notifyAdmin,
          notifySystem,
          notifyUser: notifyAdmin ? undefined : entity.requestedBy,
          event,
          subject: `${work.title}${releaseYear ? ` (${releaseYear})` : ''}`,
          message: description
            ? truncate(description, {
                length: 500,
                separator: /\s/,
                omission: '…',
              })
            : undefined,
          image: coverId
            ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
            : undefined,
          extra: isbn
            ? [
                {
                  name: 'ISBN',
                  value: isbn,
                },
              ]
            : undefined,
        });
      }
    } catch (e) {
      logger.error('Something went wrong sending media notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        requestId: entity.id,
        mediaId: entity.media.id,
      });
    }
  }
}

export default MediaRequest;
