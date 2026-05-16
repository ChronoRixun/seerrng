import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import LibraryFilterSlideover, {
  countLibraryFilters,
} from '@app/components/Discover/LibraryFilterSlideover';
import useDiscover from '@app/hooks/useDiscover';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon, FunnelIcon } from '@heroicons/react/24/solid';
import type { BookResult } from '@server/models/Book';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverBooks', {
  books: 'Books',
  activefilters:
    '{count, plural, one {# Active Filter} other {# Active Filters}}',
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
  const [showFilters, setShowFilters] = useState(false);
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
    query ? { query } : { subject }
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
        <div className="mt-2 flex flex-grow flex-col gap-2 sm:flex-row lg:mt-0 lg:flex-grow-0">
          <div className="mb-2 flex flex-grow sm:mb-0 sm:mr-2 lg:flex-grow-0">
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
          <LibraryFilterSlideover
            type="book"
            query={query}
            subject={subject}
            onClose={() => setShowFilters(false)}
            show={showFilters}
          />
          <div className="mb-2 flex flex-grow sm:mb-0 lg:flex-grow-0">
            <Button onClick={() => setShowFilters(true)} className="w-full">
              <FunnelIcon />
              <span>
                {intl.formatMessage(messages.activefilters, {
                  count: countLibraryFilters({ type: 'book', query, subject }),
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

export default DiscoverBooks;
