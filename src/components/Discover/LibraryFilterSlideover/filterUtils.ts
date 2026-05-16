export const countLibraryFilters = ({
  type,
  query,
  subject,
  days,
  sortBy,
}: {
  type: 'book' | 'music';
  query?: string;
  subject?: string;
  days?: string;
  sortBy?: string;
}): number => {
  let count = 0;

  if (query) {
    count += 1;
  }

  if (type === 'book' && subject && subject !== 'fiction') {
    count += 1;
  }

  if (type === 'music' && days && days !== '7') {
    count += 1;
  }

  if (type === 'music' && sortBy && sortBy !== 'release_date.desc') {
    count += 1;
  }

  return count;
};
