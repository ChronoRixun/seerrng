import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import {
  BarsArrowDownIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type { BookResult } from '@server/models/Book';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverBooks', {
  books: 'Books',
  searchPlaceholder: 'Search books',
  search: 'Search',
  clearSearch: 'Clear Search',
  fiction: 'Fiction',
  fantasy: 'Fantasy',
  scienceFiction: 'Science Fiction',
  mystery: 'Mystery',
  biography: 'Biography',
  romance: 'Romance',
});

const DiscoverBooks = () => {
  const intl = useIntl();
  const router = useRouter();
  const updateQueryParams = useBatchUpdateQueryParams({});
  const title = intl.formatMessage(messages.books);
  const query =
    typeof router.query.query === 'string' ? router.query.query : '';
  const subject =
    typeof router.query.subject === 'string' ? router.query.subject : 'fiction';
  const [searchValue, setSearchValue] = useState(query);
  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<BookResult>(
    '/api/v1/discover/books',
    query ? { query } : { subject },
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
        <div className="mt-2 flex flex-grow flex-col gap-2 sm:flex-row lg:mt-0 lg:flex-grow-0">
          <form
            className="flex w-full sm:w-96"
            onSubmit={(e) => {
              e.preventDefault();
              updateQueryParams({
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
                id="book-query"
                name="book-query"
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
                  updateQueryParams({ query: undefined, page: undefined });
                }}
              >
                <XMarkIcon />
                <span>{intl.formatMessage(messages.clearSearch)}</span>
              </Button>
            )}
          </form>
          <div className="flex flex-grow lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <BarsArrowDownIcon className="h-6 w-6" />
            </span>
            <select
              id="subject"
              name="subject"
              className="rounded-r-only"
              value={subject}
              disabled={!!query}
              onChange={(e) =>
                updateQueryParams({
                  subject: e.target.value,
                  page: undefined,
                })
              }
            >
              <option value="fiction">
                {intl.formatMessage(messages.fiction)}
              </option>
              <option value="fantasy">
                {intl.formatMessage(messages.fantasy)}
              </option>
              <option value="science_fiction">
                {intl.formatMessage(messages.scienceFiction)}
              </option>
              <option value="mystery">
                {intl.formatMessage(messages.mystery)}
              </option>
              <option value="biography">
                {intl.formatMessage(messages.biography)}
              </option>
              <option value="romance">
                {intl.formatMessage(messages.romance)}
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

export default DiscoverBooks;
