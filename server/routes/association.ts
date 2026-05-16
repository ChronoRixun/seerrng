import { getAssociations } from '@server/lib/associations';
import type { AssociationMediaType } from '@server/lib/associations/types';
import logger from '@server/logger';
import { Router } from 'express';

const associationRoutes = Router();

const VALID_MEDIA_TYPES = new Set<AssociationMediaType>([
  'movie',
  'tv',
  'album',
  'artist',
]);

associationRoutes.get('/:mediaType/:id', async (req, res, next) => {
  const mediaType = req.params.mediaType as AssociationMediaType;

  if (!VALID_MEDIA_TYPES.has(mediaType)) {
    return next({
      status: 400,
      message: 'Invalid association media type.',
    });
  }

  if (
    (mediaType === 'movie' || mediaType === 'tv') &&
    !Number.isFinite(Number(req.params.id))
  ) {
    return next({
      status: 400,
      message: 'Invalid association media id.',
    });
  }

  const limitParam = Number(req.query.limit);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 60)
      : undefined;

  try {
    const graph = await getAssociations(mediaType, req.params.id, req.user, {
      includeWeak: req.query.includeWeak === 'true',
      limit,
    });

    return res.status(200).json(graph);
  } catch (e) {
    logger.debug('Something went wrong retrieving associations', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      mediaType,
      id: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve associations.',
    });
  }
});

export default associationRoutes;
