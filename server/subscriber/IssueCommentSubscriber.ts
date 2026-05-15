import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import { IssueType, IssueTypeName } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import IssueComment from '@server/entity/IssueComment';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import notificationManager, { Notification } from '@server/lib/notifications';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { sortBy } from 'lodash';
import type { EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { EventSubscriber } from 'typeorm';

@EventSubscriber()
export class IssueCommentSubscriber implements EntitySubscriberInterface<IssueComment> {
  public listenTo(): typeof IssueComment {
    return IssueComment;
  }

  private async getIssueMediaDetails(media: Media): Promise<{
    title: string;
    image: string;
  }> {
    if (media.mediaType === MediaType.MOVIE) {
      const tmdb = new TheMovieDb();
      const movie = await tmdb.getMovie({ movieId: media.tmdbId });

      return {
        title: `${movie.title}${
          movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
        }`,
        image: movie.poster_path
          ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`
          : '',
      };
    }

    if (media.mediaType === MediaType.TV) {
      const tmdb = new TheMovieDb();
      const tvshow = await tmdb.getTvShow({ tvId: media.tmdbId });

      return {
        title: `${tvshow.name}${
          tvshow.first_air_date ? ` (${tvshow.first_air_date.slice(0, 4)})` : ''
        }`,
        image: tvshow.poster_path
          ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tvshow.poster_path}`
          : '',
      };
    }

    if (media.mediaType === MediaType.MUSIC && media.mbId) {
      const album = await new ListenBrainzAPI().getAlbum(media.mbId);

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

    if (media.mediaType === MediaType.BOOK) {
      const identifiers = await getRepository(MediaIdentifier).find({
        where: { media: { id: media.id } },
      });
      const openLibraryId = identifiers.find(
        (identifier) =>
          identifier.provider === MediaIdentifierProvider.OPENLIBRARY
      )?.value;

      if (openLibraryId) {
        const work = await new OpenLibraryAPI().getWork(openLibraryId);
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
      title: media.mbId ?? media.tmdbId.toString(),
      image: '',
    };
  }

  private async sendIssueCommentNotification(entity: IssueComment) {
    try {
      const issue = (
        await getRepository(IssueComment).findOneOrFail({
          where: { id: entity.id },
          relations: { issue: true },
        })
      ).issue;

      const createdBy = await getRepository(User).findOneOrFail({
        where: { id: issue.createdBy.id },
      });

      const media = await getRepository(Media).findOneOrFail({
        where: { id: issue.media.id },
      });

      const { title, image } = await this.getIssueMediaDetails(media);

      const [firstComment] = sortBy(issue.comments, 'id');

      if (entity.id !== firstComment.id) {
        // Send notifications to all issue managers
        notificationManager.sendNotification(Notification.ISSUE_COMMENT, {
          event: `New Comment on ${
            issue.issueType !== IssueType.OTHER
              ? `${IssueTypeName[issue.issueType]} `
              : ''
          }Issue`,
          subject: title,
          message: firstComment.message,
          comment: entity,
          issue,
          media,
          image,
          notifyAdmin: true,
          notifySystem: true,
          notifyUser:
            !createdBy.hasPermission(Permission.MANAGE_ISSUES) &&
            createdBy.id !== entity.user.id
              ? createdBy
              : undefined,
        });
      }
    } catch (e) {
      logger.error(
        'Something went wrong sending issue comment notification(s)',
        {
          label: 'Notifications',
          errorMessage: e.message,
          commentId: entity.id,
        }
      );
    }
  }

  public afterInsert(event: InsertEvent<IssueComment>): void {
    if (!event.entity) {
      return;
    }

    this.sendIssueCommentNotification(event.entity);
  }
}
