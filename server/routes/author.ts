import OpenLibraryAPI from '@server/api/openlibrary';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import logger from '@server/logger';
import {
  mapOpenLibraryAuthorWork,
  type AuthorDetails,
} from '@server/models/Book';
import { Router } from 'express';
import { In } from 'typeorm';

const authorRoutes = Router();

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

const getAuthorWorksPayload = async (
  authorId: string,
  limit: number,
  offset: number,
  userId?: number
) => {
  const openLibrary = new OpenLibraryAPI();
  const works = await openLibrary.getAuthorWorks(authorId, { limit, offset });
  const ids = works.entries.map((work) => work.key.replace('/works/', ''));
  const mediaByOpenLibraryId = await findBookMediaByOpenLibraryIds(ids, userId);

  return {
    works: works.entries.map((work) =>
      mapOpenLibraryAuthorWork(
        work,
        mediaByOpenLibraryId.get(work.key.replace('/works/', '')),
        undefined,
        authorId.replace(/^\/?authors\//, '')
      )
    ),
    pagination: {
      limit,
      offset,
      totalItems: works.size,
    },
  };
};

authorRoutes.get<{ id: string }, AuthorDetails>(
  '/:id',
  async (req, res, next) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const openLibrary = new OpenLibraryAPI();

    try {
      const [author, worksPayload] = await Promise.all([
        openLibrary.getAuthor(req.params.id),
        getAuthorWorksPayload(req.params.id, limit, offset, req.user?.id),
      ]);
      const biography =
        typeof author.bio === 'string' ? author.bio : author.bio?.value;
      const normalizedAuthorId = author.key.replace('/authors/', '');

      return res.status(200).json({
        id: normalizedAuthorId,
        name: author.name,
        biography,
        birthDate: author.birth_date,
        deathDate: author.death_date,
        posterPath: author.photos?.[0]
          ? `https://covers.openlibrary.org/a/id/${author.photos[0]}-L.jpg`
          : undefined,
        works: worksPayload.works.map((work) => ({
          ...work,
          author: author.name,
          authorId: normalizedAuthorId,
        })),
        pagination: worksPayload.pagination,
      });
    } catch (e) {
      logger.error('Failed to retrieve author details', {
        label: 'Author',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
        authorId: req.params.id,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve author details.',
      });
    }
  }
);

authorRoutes.get<{ id: string }>('/:id/works', async (req, res, next) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  try {
    const [author, worksPayload] = await Promise.all([
      new OpenLibraryAPI().getAuthor(req.params.id).catch(() => undefined),
      getAuthorWorksPayload(req.params.id, limit, offset, req.user?.id),
    ]);

    return res.status(200).json({
      ...worksPayload,
      works: worksPayload.works.map((work) => ({
        ...work,
        author: author?.name ?? work.author,
        authorId: req.params.id.replace(/^\/?authors\//, ''),
      })),
    });
  } catch (e) {
    logger.error('Failed to retrieve author works', {
      label: 'Author',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      authorId: req.params.id,
    });
    return next({ status: 500, message: 'Unable to retrieve author works.' });
  }
});

export default authorRoutes;
