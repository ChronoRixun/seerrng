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
  sort: 'Sort',
  releaseWindow: 'Release Window',
  genre: 'Genre',
  releaseType: 'Release Type',
  clearfilters: 'Clear Active Filters',
  allRecommended: 'All Recommended',
  fiction: 'Fiction',
  fantasy: 'Fantasy',
  scienceFiction: 'Science Fiction',
  mystery: 'Mystery',
  biography: 'Biography',
  romance: 'Romance',
  allGenres: 'All Genres',
  alternative: 'Alternative',
  classical: 'Classical',
  country: 'Country',
  electronic: 'Electronic',
  hipHop: 'Hip-Hop',
  jazz: 'Jazz',
  metal: 'Metal',
  pop: 'Pop',
  rock: 'Rock',
  allTypes: 'All Types',
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  last7Days: 'Last 7 Days',
  last14Days: 'Last 14 Days',
  last30Days: 'Last 30 Days',
  last90Days: 'Last 90 Days',
  recommended: 'Recommended',
  highestRated: 'Highest Rated',
  mostEditions: 'Most Editions',
  newestFirst: 'Newest First',
  oldestFirst: 'Oldest First',
  random: 'Random',
  popularWeek: 'Popular This Week',
  popularMonth: 'Popular This Month',
  popularYear: 'Popular This Year',
  mostListened: 'Most Listened',
});

type LibraryFilterSlideoverProps = {
  show: boolean;
  onClose: () => void;
  type: 'book' | 'music';
  query?: string;
  subject?: string;
  days?: string;
  genre?: string;
  releaseType?: string;
  sortBy?: string;
};

const LibraryFilterSlideover = ({
  show,
  onClose,
  type,
  query = '',
  subject = '',
  days = '14',
  genre,
  releaseType,
  sortBy = 'ranked',
}: LibraryFilterSlideoverProps) => {
  const intl = useIntl();
  const updateQueryParams = useBatchUpdateQueryParams({});
  const [searchValue, setSearchValue] = useState(query);
  const activeFilterCount = countLibraryFilters({
    type,
    query,
    subject,
    days,
    genre,
    releaseType,
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
          <>
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
                <option value="">
                  {intl.formatMessage(messages.allRecommended)}
                </option>
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
            <div>
              <label
                htmlFor="book-discover-sort"
                className="text-lg font-semibold"
              >
                {intl.formatMessage(messages.sort)}
              </label>
              <select
                id="book-discover-sort"
                name="book-discover-sort"
                className="mt-2"
                value={sortBy}
                onChange={(e) =>
                  updateQueryParams({
                    sortBy: e.target.value,
                    page: undefined,
                  })
                }
              >
                <option value="ranked">
                  {intl.formatMessage(messages.recommended)}
                </option>
                <option value="rating">
                  {intl.formatMessage(messages.highestRated)}
                </option>
                <option value="editions">
                  {intl.formatMessage(messages.mostEditions)}
                </option>
                <option value="newest">
                  {intl.formatMessage(messages.newestFirst)}
                </option>
                <option value="oldest">
                  {intl.formatMessage(messages.oldestFirst)}
                </option>
                <option value="random">
                  {intl.formatMessage(messages.random)}
                </option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label
                htmlFor="music-discover-sort"
                className="text-lg font-semibold"
              >
                {intl.formatMessage(messages.sort)}
              </label>
              <select
                id="music-discover-sort"
                name="music-discover-sort"
                className="mt-2"
                value={sortBy}
                disabled={!!query}
                onChange={(e) =>
                  updateQueryParams({
                    sortBy: e.target.value,
                    page: undefined,
                  })
                }
              >
                <option value="ranked">
                  {intl.formatMessage(messages.recommended)}
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
                  {intl.formatMessage(messages.mostListened)}
                </option>
                <option value="release_date.desc">
                  {intl.formatMessage(messages.newestFirst)}
                </option>
                <option value="release_date.asc">
                  {intl.formatMessage(messages.oldestFirst)}
                </option>
              </select>
            </div>
            <div>
              <label
                htmlFor="music-discover-genre"
                className="text-lg font-semibold"
              >
                {intl.formatMessage(messages.genre)}
              </label>
              <select
                id="music-discover-genre"
                name="music-discover-genre"
                className="mt-2"
                value={genre ?? ''}
                disabled={!!query}
                onChange={(e) =>
                  updateQueryParams({
                    genre: e.target.value || undefined,
                    page: undefined,
                  })
                }
              >
                <option value="">
                  {intl.formatMessage(messages.allGenres)}
                </option>
                <option value="alternative">
                  {intl.formatMessage(messages.alternative)}
                </option>
                <option value="classical">
                  {intl.formatMessage(messages.classical)}
                </option>
                <option value="country">
                  {intl.formatMessage(messages.country)}
                </option>
                <option value="electronic">
                  {intl.formatMessage(messages.electronic)}
                </option>
                <option value="hip hop">
                  {intl.formatMessage(messages.hipHop)}
                </option>
                <option value="jazz">
                  {intl.formatMessage(messages.jazz)}
                </option>
                <option value="metal">
                  {intl.formatMessage(messages.metal)}
                </option>
                <option value="pop">{intl.formatMessage(messages.pop)}</option>
                <option value="rock">
                  {intl.formatMessage(messages.rock)}
                </option>
              </select>
            </div>
            <div>
              <label
                htmlFor="music-discover-release-type"
                className="text-lg font-semibold"
              >
                {intl.formatMessage(messages.releaseType)}
              </label>
              <select
                id="music-discover-release-type"
                name="music-discover-release-type"
                className="mt-2"
                value={releaseType ?? ''}
                disabled={!!query}
                onChange={(e) =>
                  updateQueryParams({
                    releaseType: e.target.value || undefined,
                    page: undefined,
                  })
                }
              >
                <option value="">
                  {intl.formatMessage(messages.allTypes)}
                </option>
                <option value="Album">
                  {intl.formatMessage(messages.album)}
                </option>
                <option value="EP">{intl.formatMessage(messages.ep)}</option>
                <option value="Single">
                  {intl.formatMessage(messages.single)}
                </option>
              </select>
            </div>
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
                disabled={!!query || !!genre}
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
                <option value="14">
                  {intl.formatMessage(messages.last14Days)}
                </option>
                <option value="30">
                  {intl.formatMessage(messages.last30Days)}
                </option>
                <option value="90">
                  {intl.formatMessage(messages.last90Days)}
                </option>
              </select>
            </div>
          </>
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
                genre: undefined,
                releaseType: undefined,
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
