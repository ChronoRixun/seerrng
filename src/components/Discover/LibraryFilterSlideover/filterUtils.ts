const bookSortOptions = new Set([
  'ranked',
  'newest',
  'oldest',
  'random',
  'rating',
  'editions',
]);

const musicSortOptions = new Set([
  'ranked',
  'popular.week',
  'popular.month',
  'popular.year',
  'listen_count.desc',
  'release_date.desc',
  'release_date.asc',
]);

export const countLibraryFilters = ({
  type,
  query,
  subject,
  days,
  genre,
  releaseType,
  sortBy,
}: {
  type: 'book' | 'music';
  query?: string;
  subject?: string;
  days?: string;
  genre?: string;
  releaseType?: string;
  sortBy?: string;
}): number => {
  let count = 0;

  if (query) {
    count += 1;
  }

  if (type === 'book' && subject) {
    count += 1;
  }

  if (
    type === 'book' &&
    sortBy &&
    bookSortOptions.has(sortBy) &&
    sortBy !== 'ranked'
  ) {
    count += 1;
  }

  if (type === 'music' && days && days !== '14') {
    count += 1;
  }

  if (
    type === 'music' &&
    sortBy &&
    musicSortOptions.has(sortBy) &&
    sortBy !== 'ranked'
  ) {
    count += 1;
  }

  if (type === 'music' && genre) {
    count += 1;
  }

  if (type === 'music' && releaseType) {
    count += 1;
  }

  return count;
};
