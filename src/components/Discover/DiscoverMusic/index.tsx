import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import {
  useBatchUpdateQueryParams,
  useUpdateQueryParams,
} from '@app/hooks/useUpdateQueryParams';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import {
  BarsArrowDownIcon,
  CalendarDaysIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type { AlbumResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMusic', {
  music: 'Music',
  searchPlaceholder: 'Search music',
  search: 'Search',
  clearSearch: 'Clear Search',
  dateDesc: 'Newest First',
  dateAsc: 'Oldest First',
  last7Days: 'Last 7 Days',
  last30Days: 'Last 30 Days',
  last90Days: 'Last 90 Days',
});

const DiscoverMusic = () => {
  const intl = useIntl();
  const router = useRouter();
  const updateQueryParams = useUpdateQueryParams({});
  const updateBatchQueryParams = useBatchUpdateQueryParams({});
  const title = intl.formatMessage(messages.music);
  const query =
    typeof router.query.query === 'string' ? router.query.query : '';
  const [searchValue, setSearchValue] = useState(query);
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

  useEffect(() => {
    setSearchValue(query);
  }, [query]);

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
        <div className="mt-2 flex flex-grow flex-col gap-2 sm:flex-row lg:flex-grow-0">
          <form
            className="flex w-full sm:w-80"
            onSubmit={(e) => {
              e.preventDefault();
              updateBatchQueryParams({
                query: searchValue.trim() || undefined,
                page: undefined,
              });
            }}
          >
            <div className="flex min-w-0 flex-1">
              <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
                <MagnifyingGlassIcon className="h-6 w-6" />
              </span>
              <input
                id="music-query"
                name="music-query"
                type="search"
                className="rounded-r-none"
                placeholder={intl.formatMessage(messages.searchPlaceholder)}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
            </div>
            <Button buttonType="primary" className="ml-2" type="submit">
              <MagnifyingGlassIcon />
              <span>{intl.formatMessage(messages.search)}</span>
            </Button>
            {!!query && (
              <Button
                className="ml-2"
                type="button"
                onClick={() => {
                  setSearchValue('');
                  updateBatchQueryParams({
                    query: undefined,
                    page: undefined,
                  });
                }}
              >
                <XMarkIcon />
                <span>{intl.formatMessage(messages.clearSearch)}</span>
              </Button>
            )}
          </form>
          <div className="mb-2 flex flex-grow sm:mb-0 sm:mr-2 lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <CalendarDaysIcon className="h-6 w-6" />
            </span>
            <select
              id="days"
              name="days"
              className="rounded-r-only"
              value={days}
              disabled={!!query}
              onChange={(e) => updateQueryParams('days', e.target.value)}
            >
              <option value="7">
                {intl.formatMessage(messages.last7Days)}
              </option>
              <option value="30">
                {intl.formatMessage(messages.last30Days)}
              </option>
              <option value="90">
                {intl.formatMessage(messages.last90Days)}
              </option>
            </select>
          </div>
          <div className="mb-2 flex flex-grow sm:mb-0 lg:flex-grow-0">
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
