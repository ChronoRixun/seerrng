import Slider from '@app/components/Slider';
import TitleCard from '@app/components/TitleCard';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.PlexWatchlistSlider', {
  plexwatchlist: 'Your Watchlist',
  emptywatchlist:
    'Media added to your <PlexWatchlistSupportLink>Plex Watchlist</PlexWatchlistSupportLink> will appear here.',
});

const PlexWatchlistSlider = () => {
  const intl = useIntl();
  const { user } = useUser();

  const { data: watchlistItems, error: watchlistError } = useSWR<{
    page: number;
    totalPages: number;
    totalResults: number;
    results: WatchlistItem[];
  }>('/api/v1/discover/watchlist', {
    revalidateOnMount: true,
  });

  if (
    (watchlistItems &&
      watchlistItems.results.length === 0 &&
      !user?.settings?.watchlistSyncMovies &&
      !user?.settings?.watchlistSyncTv &&
      !user?.settings?.watchlistSyncMusic &&
      !user?.settings?.watchlistSyncBooks) ||
    watchlistError
  ) {
    return null;
  }

  return (
    <>
      <div className="slider-header">
        <Link href="/discover/watchlist" className="slider-title">
          <span>{intl.formatMessage(messages.plexwatchlist)}</span>
          <ArrowRightCircleIcon />
        </Link>
      </div>
      <Slider
        sliderKey="watchlist"
        isLoading={!watchlistItems}
        isEmpty={!!watchlistItems && watchlistItems.results.length === 0}
        emptyMessage={intl.formatMessage(messages.emptywatchlist, {
          PlexWatchlistSupportLink: (msg: React.ReactNode) => (
            <a
              href="https://support.plex.tv/articles/universal-watchlist/"
              className="text-white transition duration-300 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {msg}
            </a>
          ),
        })}
        items={watchlistItems?.results.map((item) => (
          <div key={`watchlist-slider-item-${item.ratingKey}`}>
            {item.mediaType === 'music' && item.mbId ? (
              <TitleCard
                id={item.mbId}
                title={item.title}
                mediaType="album"
                isAddedToWatchlist={true}
              />
            ) : item.mediaType === 'book' && item.externalId ? (
              <TitleCard
                id={item.externalId}
                title={item.title}
                mediaType="book"
                isAddedToWatchlist={true}
              />
            ) : item.tmdbId ? (
              <TmdbTitleCard
                id={item.tmdbId}
                tmdbId={item.tmdbId}
                type={item.mediaType === 'tv' ? 'tv' : 'movie'}
                isAddedToWatchlist={true}
              />
            ) : null}
          </div>
        ))}
      />
    </>
  );
};

export default PlexWatchlistSlider;
