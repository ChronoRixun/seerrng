import { MediaType } from '@server/constants/media';
import { z } from 'zod';

const maxWatchlistId = 1_000_000_000;
const maxWatchlistTextLength = 512;

export const watchlistCreate = z.object({
  ratingKey: z.string().trim().min(1).max(maxWatchlistTextLength).optional(),
  tmdbId: z.coerce.number().int().positive().max(maxWatchlistId).optional(),
  mbId: z.string().trim().min(1).max(maxWatchlistTextLength).optional(),
  externalId: z.string().trim().min(1).max(maxWatchlistTextLength).optional(),
  mediaType: z.nativeEnum(MediaType),
  title: z.string().trim().max(maxWatchlistTextLength).optional(),
});
