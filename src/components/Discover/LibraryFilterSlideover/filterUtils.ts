export const countLibraryFilters = ({
  type,
  query,
  subject,
  days,
  genre,
  releaseType,
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

  if (type === 'book' && subject && subject !== 'fiction') {
    count += 1;
  }

  if (type === 'music' && days && days !== '14') {
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
