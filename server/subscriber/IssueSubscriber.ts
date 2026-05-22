import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import { IssueStatus, IssueType, IssueTypeName } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import notificationManager, { Notification } from '@server/lib/notifications';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { sortBy } from 'lodash';
import type {
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import { EventSubscriber } from 'typeorm';

@EventSubscriber()
export class IssueSubscriber implements EntitySubscriberInterface<Issue> {
  public listenTo(): typeof Issue {
    return Issue;
  }

  private async getIssueMediaDetails(entity: Issue): Promise<{
    title: string;
    image: string;
  }> {
    if (entity.media.mediaType === MediaType.MOVIE) {
      const tmdb = new TheMovieDb();
      const movie = await tmdb.getMovie({ movieId: entity.media.tmdbId });

      return {
        title: `${movie.title}${
          movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
        }`,
        image: movie.poster_path
          ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`
          : '',
      };
    }

    if (entity.media.mediaType === MediaType.TV) {
      const tmdb = new TheMovieDb();
      const tvshow = await tmdb.getTvShow({ tvId: entity.media.tmdbId });

      return {
        title: `${tvshow.name}${
          tvshow.first_air_date ? ` (${tvshow.first_air_date.slice(0, 4)})` : ''
        }`,
        image: tvshow.poster_path
          ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tvshow.poster_path}`
          : '',
      };
    }

    if (entity.media.mediaType === MediaType.MUSIC && entity.media.mbId) {
      const listenBrainz = new ListenBrainzAPI();
      const album = await listenBrainz.getAlbum(
        normalizeMusicBrainzId(entity.media.mbId)
      );

      return {
        title: `${album.release_group_metadata.release_group.name}${
          album.release_group_metadata.release_group.date
            ? ` (${album.release_group_metadata.release_group.date.slice(0, 4)})`
            : ''
        }`,
        image: album.caa_release_mbid
          ? `https://coverartarchive.org/release/${album.caa_release_mbid}/front-500`
          : '',
      };
    }

    if (entity.media.mediaType === MediaType.BOOK) {
      const identifiers =
        entity.media.identifiers ??
        (await getRepository(MediaIdentifier).find({
          where: { media: { id: entity.media.id } },
        }));
      const openLibraryId = identifiers.find(
        (identifier) =>
          identifier.provider === MediaIdentifierProvider.OPENLIBRARY
      )?.value;

      if (openLibraryId) {
        const openLibrary = new OpenLibraryAPI();
        const work = await openLibrary.getWork(
          normalizeOpenLibraryWorkId(openLibraryId)
        );
        const coverId = work.covers?.[0];
        const releaseYear = work.first_publish_date?.match(/\d{4}/)?.[0];

        return {
          title: `${work.title}${releaseYear ? ` (${releaseYear})` : ''}`,
          image: coverId
            ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
            : '',
        };
      }
    }

    return {
      title: entity.media.mbId ?? entity.media.tmdbId.toString(),
      image: '',
    };
  }

  private async sendIssueNotification(entity: Issue, type: Notification) {
    try {
      const { title, image } = await this.getIssueMediaDetails(entity);

      const [firstComment] = sortBy(entity.comments, 'id');
      const extra: { name: string; value: string }[] = [];

      if (entity.media.mediaType === MediaType.TV && entity.problemSeason > 0) {
        extra.push({
          name: 'Affected Season',
          value: entity.problemSeason.toString(),
        });

        if (entity.problemEpisode > 0) {
          extra.push({
            name: 'Affected Episode',
            value: entity.problemEpisode.toString(),
          });
        }
      }

      notificationManager.sendNotification(type, {
        event:
          type === Notification.ISSUE_CREATED
            ? `New ${
                entity.issueType !== IssueType.OTHER
                  ? `${IssueTypeName[entity.issueType]} `
                  : ''
              }Issue Reported`
            : type === Notification.ISSUE_RESOLVED
              ? `${
                  entity.issueType !== IssueType.OTHER
                    ? `${IssueTypeName[entity.issueType]} `
                    : ''
                }Issue Resolved`
              : `${
                  entity.issueType !== IssueType.OTHER
                    ? `${IssueTypeName[entity.issueType]} `
                    : ''
                }Issue Reopened`,
        subject: title,
        message: firstComment.message,
        issue: entity,
        media: entity.media,
        image,
        extra,
        notifyAdmin: true,
        notifySystem: true,
        notifyUser:
          !entity.createdBy.hasPermission(Permission.MANAGE_ISSUES) &&
          entity.modifiedBy?.id !== entity.createdBy.id &&
          (type === Notification.ISSUE_RESOLVED ||
            type === Notification.ISSUE_REOPENED)
            ? entity.createdBy
            : undefined,
      });
    } catch (e) {
      logger.error('Something went wrong sending issue notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        issueId: entity.id,
      });
    }
  }

  public afterInsert(event: InsertEvent<Issue>): void {
    if (!event.entity) {
      return;
    }

    this.sendIssueNotification(event.entity, Notification.ISSUE_CREATED);
  }

  public beforeUpdate(event: UpdateEvent<Issue>): void {
    if (!event.entity) {
      return;
    }

    if (
      event.entity.status === IssueStatus.RESOLVED &&
      event.databaseEntity.status !== IssueStatus.RESOLVED
    ) {
      this.sendIssueNotification(
        event.entity as Issue,
        Notification.ISSUE_RESOLVED
      );
    } else if (
      event.entity.status === IssueStatus.OPEN &&
      event.databaseEntity.status !== IssueStatus.OPEN
    ) {
      this.sendIssueNotification(
        event.entity as Issue,
        Notification.ISSUE_REOPENED
      );
    }
  }
}
