import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import LibraryFilterSlideover, {
  countLibraryFilters,
} from '@app/components/Discover/LibraryFilterSlideover';
import useDiscover from '@app/hooks/useDiscover';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon, FunnelIcon } from '@heroicons/react/24/solid';
import type { AlbumResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMusic', {
  music: 'Music',
  activefilters:
    '{count, plural, one {# Active Filter} other {# Active Filters}}',
  dateDesc: 'Newest First',
  dateAsc: 'Oldest First',
});

const DiscoverMusic = () => {
  const intl = useIntl();
  const router = useRouter();
  const updateQueryParams = useUpdateQueryParams({});
  const title = intl.formatMessage(messages.music);
  const query =
    typeof router.query.query === 'string' ? router.query.query : '';
  const [showFilters, setShowFilters] = useState(false);
  const days = typeof router.query.days === 'string' ? router.query.days : '7';
  const sortBy =
    typeof router.query.sortBy === 'string'
      ? router.query.sortBy
      : 'release_date.desc';
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
    query ? { query } : { days, sortBy },
    { hideAvailable: false, hideBlocklisted: false }
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
              <option value="release_date.desc">
                {intl.formatMessage(messages.dateDesc)}
              </option>
              <option value="release_date.asc">
                {intl.formatMessage(messages.dateAsc)}
              </option>
            </select>
          </div>
          <LibraryFilterSlideover
            type="music"
            query={query}
            days={days}
            onClose={() => setShowFilters(false)}
            show={showFilters}
          />
          <div className="mb-2 flex flex-grow sm:mb-0 lg:flex-grow-0">
            <Button onClick={() => setShowFilters(true)} className="w-full">
              <FunnelIcon />
              <span>
                {intl.formatMessage(messages.activefilters, {
                  count: countLibraryFilters({ type: 'music', query, days }),
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
