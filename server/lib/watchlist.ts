import PlexTvAPI from '@server/api/plextv';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { Watchlist } from '@server/entity/Watchlist';
import type {
  WatchlistItem,
  WatchlistResponse,
} from '@server/interfaces/api/discoverInterfaces';

const mapLocalWatchlistItem = (item: Watchlist): WatchlistItem => ({
  id: item.id,
  ratingKey:
    item.ratingKey || item.mbId || item.externalId || item.id.toString(),
  tmdbId: item.tmdbId,
  mbId: item.mbId,
  externalId: item.externalId,
  mediaType: item.mediaType as 'movie' | 'tv' | 'music' | 'book',
  title: item.title,
});

const isRenderableWatchlistItem = (item: Watchlist): boolean =>
  ((item.mediaType === MediaType.MOVIE || item.mediaType === MediaType.TV) &&
    item.tmdbId !== undefined) ||
  (item.mediaType === MediaType.MUSIC && !!item.mbId) ||
  (item.mediaType === MediaType.BOOK && !!item.externalId);

export const getCombinedWatchlist = async ({
  userId,
  plexToken,
  page,
  itemsPerPage,
}: {
  userId?: number;
  plexToken?: string | null;
  page: number;
  itemsPerPage: number;
}): Promise<WatchlistResponse> => {
  if (!userId) {
    return {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    };
  }

  const offset = (page - 1) * itemsPerPage;
  const watchlistRepository = getRepository(Watchlist);
  const localWhere = { requestedBy: { id: userId } };
  const localTotal = await watchlistRepository.count({ where: localWhere });
  const localTake = Math.max(
    itemsPerPage - Math.max(offset - localTotal, 0),
    0
  );
  const localSkip = Math.min(offset, localTotal);
  const localResult =
    localTake > 0
      ? await watchlistRepository.find({
          where: localWhere,
          take: localTake,
          skip: localSkip,
        })
      : [];
  const localItems = localResult
    .filter(isRenderableWatchlistItem)
    .map(mapLocalWatchlistItem);

  if (!plexToken) {
    return {
      page,
      totalPages: Math.max(Math.ceil(localTotal / itemsPerPage), 1),
      totalResults: localTotal,
      results: localItems,
    };
  }

  const plexTV = new PlexTvAPI(plexToken);
  const plexOffset = Math.max(offset - localTotal, 0);
  const plexWatchlist = await plexTV.getWatchlist({ offset: plexOffset });
  const remainingItems = itemsPerPage - localItems.length;
  const plexItems = plexWatchlist.items
    .slice(0, remainingItems)
    .map<WatchlistItem>((item) => ({
      id: item.tmdbId,
      ratingKey: item.ratingKey,
      title: item.title,
      mediaType: item.type === 'show' ? MediaType.TV : MediaType.MOVIE,
      tmdbId: item.tmdbId,
    }));
  const totalResults = localTotal + plexWatchlist.totalSize;

  return {
    page,
    totalPages: Math.max(Math.ceil(totalResults / itemsPerPage), 1),
    totalResults,
    results: [...localItems, ...plexItems],
  };
};
