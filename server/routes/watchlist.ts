import {
  DuplicateWatchlistRequestError,
  NotFoundError,
  Watchlist,
} from '@server/entity/Watchlist';
import logger from '@server/logger';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { parseOptionalNonNegativeInteger } from '@server/utils/validation';
import { Router } from 'express';
import { QueryFailedError } from 'typeorm';

import { MediaType } from '@server/constants/media';
import { watchlistCreate } from '@server/interfaces/api/watchlistCreate';

const watchlistRoutes = Router();
const maxWatchlistId = 1_000_000_000;
const maxWatchlistExternalIdLength = 512;

const parseWatchlistNumericId = (id: unknown): number | undefined => {
  const parsedValue =
    typeof id === 'string' && id.trim() !== '' ? Number(id) : id;
  const parsed = parseOptionalNonNegativeInteger(parsedValue, maxWatchlistId);

  return parsed && parsed > 0 ? parsed : undefined;
};

const parseWatchlistExternalId = (id: unknown): string | undefined => {
  if (typeof id !== 'string') {
    return undefined;
  }

  const trimmed = id.trim();

  return trimmed.length > 0 && trimmed.length <= maxWatchlistExternalIdLength
    ? trimmed
    : undefined;
};

watchlistRoutes.post<never, Watchlist, Watchlist>(
  '/',
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to add watchlist.',
        });
      }
      const parsedBody = watchlistCreate.safeParse(req.body);
      if (!parsedBody.success) {
        return next({ status: 400, message: 'Invalid watchlist payload.' });
      }
      const values = parsedBody.data;

      const request = await Watchlist.createWatchlist({
        watchlistRequest: values,
        user: req.user,
      });
      return res.status(201).json(filterEntityResponse(request));
    } catch (error) {
      if (!(error instanceof Error)) {
        return;
      }

      switch (error.constructor) {
        case QueryFailedError:
          logger.warn('Something wrong with data watchlist', {
            tmdbId: req.body.tmdbId,
            mediaType: req.body.mediaType,
            label: 'Watchlist',
          });
          return next({ status: 409, message: 'Something wrong' });
        case DuplicateWatchlistRequestError:
          return next({ status: 409, message: error.message });
        default:
          return next({ status: 500, message: error.message });
      }
    }
  }
);

watchlistRoutes.delete('/:mediaId', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to delete watchlist data.',
    });
  }
  try {
    const mediaType = req.query.mediaType;
    if (
      mediaType !== MediaType.MOVIE &&
      mediaType !== MediaType.TV &&
      mediaType !== MediaType.MUSIC &&
      mediaType !== MediaType.BOOK
    ) {
      return next({
        status: 400,
        message: 'Invalid mediaType query parameter.',
      });
    }

    const mediaId =
      mediaType === MediaType.MUSIC || mediaType === MediaType.BOOK
        ? parseWatchlistExternalId(req.params.mediaId)
        : parseWatchlistNumericId(req.params.mediaId);

    if (mediaId === undefined) {
      return next({ status: 400, message: 'Invalid mediaId parameter.' });
    }

    await Watchlist.deleteWatchlist(mediaId, mediaType, req.user);
    return res.status(204).send();
  } catch (e) {
    if (e instanceof NotFoundError) {
      return next({
        status: 404,
        message: e.message,
      });
    }
    return next({ status: 500, message: e.message });
  }
});

export default watchlistRoutes;
