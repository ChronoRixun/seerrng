import Button from '@app/components/Common/Button';
import SlideOver from '@app/components/Common/SlideOver';
import { countLibraryFilters } from '@app/components/Discover/LibraryFilterSlideover/filterUtils';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.LibraryFilterSlideover', {
  filters: 'Filters',
  activefilters:
    '{count, plural, one {# Active Filter} other {# Active Filters}}',
  search: 'Search',
  searchBooks: 'Search books',
  searchMusic: 'Search music',
  subject: 'Subject',
  releaseWindow: 'Release Window',
  clearfilters: 'Clear Active Filters',
  fiction: 'Fiction',
  fantasy: 'Fantasy',
  scienceFiction: 'Science Fiction',
  mystery: 'Mystery',
  biography: 'Biography',
  romance: 'Romance',
  last7Days: 'Last 7 Days',
  last30Days: 'Last 30 Days',
  last90Days: 'Last 90 Days',
});

type LibraryFilterSlideoverProps = {
  show: boolean;
  onClose: () => void;
  type: 'book' | 'music';
  query?: string;
  subject?: string;
  days?: string;
  sortBy?: string;
};

const LibraryFilterSlideover = ({
  show,
  onClose,
  type,
  query = '',
  subject = 'fiction',
  days = '7',
  sortBy = 'release_date.desc',
}: LibraryFilterSlideoverProps) => {
  const intl = useIntl();
  const updateQueryParams = useBatchUpdateQueryParams({});
  const [searchValue, setSearchValue] = useState(query);
  const activeFilterCount = countLibraryFilters({
    type,
    query,
    subject,
    days,
    sortBy,
  });

  useEffect(() => {
    setSearchValue(query);
  }, [query]);

  return (
    <SlideOver
      show={show}
      title={intl.formatMessage(messages.filters)}
      subText={intl.formatMessage(messages.activefilters, {
        count: activeFilterCount,
      })}
      onClose={() => onClose()}
    >
      <div className="flex flex-col space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateQueryParams({
              query: searchValue.trim() || undefined,
              page: undefined,
            });
            onClose();
          }}
        >
          <label
            htmlFor={`${type}-discover-query`}
            className="text-lg font-semibold"
          >
            {intl.formatMessage(messages.search)}
          </label>
          <div className="mt-2 flex">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <MagnifyingGlassIcon className="h-6 w-6" />
            </span>
            <input
              id={`${type}-discover-query`}
              name={`${type}-discover-query`}
              type="search"
              className="rounded-r-only"
              placeholder={intl.formatMessage(
                type === 'book' ? messages.searchBooks : messages.searchMusic
              )}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </div>
          <Button buttonType="primary" className="mt-3 w-full" type="submit">
            <MagnifyingGlassIcon />
            <span>{intl.formatMessage(messages.search)}</span>
          </Button>
        </form>

        {type === 'book' ? (
          <div>
            <label
              htmlFor="book-discover-subject"
              className="text-lg font-semibold"
            >
              {intl.formatMessage(messages.subject)}
            </label>
            <select
              id="book-discover-subject"
              name="book-discover-subject"
              className="mt-2"
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
        ) : (
          <div>
            <label
              htmlFor="music-discover-days"
              className="text-lg font-semibold"
            >
              {intl.formatMessage(messages.releaseWindow)}
            </label>
            <select
              id="music-discover-days"
              name="music-discover-days"
              className="mt-2"
              value={days}
              disabled={!!query}
              onChange={(e) =>
                updateQueryParams({
                  days: e.target.value,
                  page: undefined,
                })
              }
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
        )}

        <div className="pt-4">
          <Button
            className="w-full"
            disabled={activeFilterCount === 0}
            onClick={() => {
              updateQueryParams({
                query: undefined,
                subject: undefined,
                days: undefined,
                sortBy: undefined,
                page: undefined,
              });
              onClose();
            }}
          >
            <XCircleIcon />
            <span>{intl.formatMessage(messages.clearfilters)}</span>
          </Button>
        </div>
      </div>
    </SlideOver>
  );
};

export default LibraryFilterSlideover;
