import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import { countLibraryFilters } from '@app/components/Discover/LibraryFilterSlideover/filterUtils';
import useDiscover from '@app/hooks/useDiscover';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon, FunnelIcon } from '@heroicons/react/24/solid';
import type { AlbumResult } from '@server/models/Search';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMusic', {
  music: 'Music',
  activefilters:
    '{count, plural, one {# Active Filter} other {# Active Filters}}',
  dateDesc: 'Newest First',
  dateAsc: 'Oldest First',
  ranked: 'Recommended',
  popularWeek: 'Popular This Week',
  popularMonth: 'Popular This Month',
  popularYear: 'Popular This Year',
  listenCount: 'Most Listened',
});

const LibraryFilterSlideover = dynamic(
  () => import('@app/components/Discover/LibraryFilterSlideover'),
  { ssr: false }
);

const DiscoverMusic = () => {
  const intl = useIntl();
  const router = useRouter();
  const updateQueryParams = useUpdateQueryParams({});
  const title = intl.formatMessage(messages.music);
  const query =
    typeof router.query.query === 'string' ? router.query.query : '';
  const [showFilters, setShowFilters] = useState(false);
  const days = typeof router.query.days === 'string' ? router.query.days : '14';
  const genre =
    typeof router.query.genre === 'string' ? router.query.genre : '';
  const releaseType =
    typeof router.query.releaseType === 'string'
      ? router.query.releaseType
      : '';
  const sortBy =
    typeof router.query.sortBy === 'string' ? router.query.sortBy : 'ranked';
  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<AlbumResult>(
    '/api/v1/discover/music',
    query ? { query } : { days, sortBy, genre, releaseType }
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
        <div className="mt-2 flex flex-grow flex-col gap-2 sm:flex-row lg:flex-grow-0">
          <div className="mb-2 flex flex-grow sm:mb-0 sm:mr-2 lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <BarsArrowDownIcon className="h-6 w-6" />
            </span>
            <select
              id="sortBy"
              name="sortBy"
              className="rounded-r-only"
              value={sortBy}
              disabled={!!query}
              onChange={(e) => updateQueryParams('sortBy', e.target.value)}
            >
              <option value="ranked">
                {intl.formatMessage(messages.ranked)}
              </option>
              <option value="popular.week">
                {intl.formatMessage(messages.popularWeek)}
              </option>
              <option value="popular.month">
                {intl.formatMessage(messages.popularMonth)}
              </option>
              <option value="popular.year">
                {intl.formatMessage(messages.popularYear)}
              </option>
              <option value="listen_count.desc">
                {intl.formatMessage(messages.listenCount)}
              </option>
              <option value="release_date.desc">
                {intl.formatMessage(messages.dateDesc)}
              </option>
              <option value="release_date.asc">
                {intl.formatMessage(messages.dateAsc)}
              </option>
            </select>
          </div>
          {showFilters && (
            <LibraryFilterSlideover
              type="music"
              query={query}
              days={days}
              genre={genre}
              releaseType={releaseType}
              sortBy={sortBy}
              onClose={() => setShowFilters(false)}
              show={showFilters}
            />
          )}
          <div className="mb-2 flex flex-grow sm:mb-0 lg:flex-grow-0">
            <Button onClick={() => setShowFilters(true)} className="w-full">
              <FunnelIcon />
              <span>
                {intl.formatMessage(messages.activefilters, {
                  count: countLibraryFilters({
                    type: 'music',
                    query,
                    days,
                    genre,
                    releaseType,
                    sortBy,
                  }),
                })}
              </span>
            </Button>
          </div>
        </div>
      </div>
      <ListView
        items={titles}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
      />
    </>
  );
};

export default DiscoverMusic;
