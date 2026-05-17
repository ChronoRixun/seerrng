import OpenLibraryAPI from '@server/api/openlibrary';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { Watchlist } from '@server/entity/Watchlist';
import logger from '@server/logger';
import {
  mapOpenLibrarySearchDoc,
  mapOpenLibraryWork,
} from '@server/models/Book';
import { parsePositiveInt } from '@server/utils/pagination';
import { Router } from 'express';
import { In } from 'typeorm';

const bookRoutes = Router();

const findBookMediaByOpenLibraryIds = async (
  ids: string[],
  userId?: number
): Promise<Map<string, Media>> => {
  if (!ids.length) {
    return new Map();
  }

  const identifiers = await getRepository(MediaIdentifier).find({
    where: {
      provider: MediaIdentifierProvider.OPENLIBRARY,
      value: In(ids),
    },
    relations: { media: { requests: true, watchlists: true } },
  });

  return new Map(
    identifiers
      .filter((identifier) => identifier.media.mediaType === MediaType.BOOK)
      .map((identifier) => {
        identifier.media.watchlists =
          identifier.media.watchlists?.filter(
            (watchlist) => watchlist.requestedBy.id === userId
          ) ?? [];

        return [identifier.value, identifier.media];
      })
  );
};

bookRoutes.get('/search', async (req, res, next) => {
  const query = req.query.query?.toString();
  const page = parsePositiveInt(req.query.page, 1, 500);

  if (!query) {
    return next({ status: 400, message: 'Missing query parameter.' });
  }

  try {
    const openLibrary = new OpenLibraryAPI();
    const response = await openLibrary.searchBooks({
      query,
      page,
      limit: 20,
    });
    const ids = response.docs.map((doc) => doc.key.replace('/works/', ''));
    const mediaByOpenLibraryId = await findBookMediaByOpenLibraryIds(
      ids,
      req.user?.id
    );

    return res.status(200).json({
      page,
      totalPages: Math.max(Math.ceil(response.numFound / 20), 1),
      totalResults: response.numFound,
      results: response.docs.map((doc) =>
        mapOpenLibrarySearchDoc(
          doc,
          mediaByOpenLibraryId.get(doc.key.replace('/works/', ''))
        )
      ),
    });
  } catch (e) {
    logger.error('Failed to search books', {
      label: 'Book',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      query,
    });
    return next({ status: 500, message: 'Unable to search books.' });
  }
});

bookRoutes.get('/:id', async (req, res, next) => {
  try {
    const openLibrary = new OpenLibraryAPI();
    const [work, editions, identifiers, onUserWatchlist] = await Promise.all([
      openLibrary.getWork(req.params.id),
      openLibrary.getWorkEditions(req.params.id).catch(() => ({
        size: 0,
        entries: [],
      })),
      getRepository(MediaIdentifier).find({
        where: {
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: req.params.id,
        },
        relations: {
          media: {
            requests: {
              requestedBy: true,
              modifiedBy: true,
            },
            issues: {
              createdBy: true,
              modifiedBy: true,
              comments: {
                user: true,
              },
            },
          },
        },
      }),
      getRepository(Watchlist).exist({
        where: {
          externalId: req.params.id,
          mediaType: MediaType.BOOK,
          requestedBy: { id: req.user?.id },
        },
      }),
    ]);

    const media = identifiers.find(
      (identifier) => identifier.media.mediaType === MediaType.BOOK
    )?.media;
    const authorId = work.authors?.[0]?.author.key.replace('/authors/', '');
    const author = authorId
      ? await openLibrary.getAuthor(authorId).catch(() => undefined)
      : undefined;

    return res.status(200).json(
      mapOpenLibraryWork(
        work,
        media,
        editions.entries,
        onUserWatchlist,
        author?.name
      )
    );
  } catch (e) {
    logger.error('Failed to retrieve book details', {
      label: 'Book',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      bookId: req.params.id,
    });
    return next({ status: 500, message: 'Unable to retrieve book details.' });
  }
});

export default bookRoutes;
