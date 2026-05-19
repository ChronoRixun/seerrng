export type BookshelfProvider = 'hardcover' | 'softcover' | 'unknown';

export const classifyBookshelfProvider = (
  metadataSource?: string
): BookshelfProvider => {
  const normalizedMetadataSource = metadataSource?.toLowerCase() ?? '';

  if (normalizedMetadataSource.includes('hardcover')) {
    return 'hardcover';
  }

  if (
    normalizedMetadataSource.includes('goodreads') ||
    normalizedMetadataSource.includes('rreading-glasses') ||
    normalizedMetadataSource.includes('127.0.0.1:8790') ||
    normalizedMetadataSource.includes('localhost:8790')
  ) {
    return 'softcover';
  }

  return 'unknown';
};

export const getBookshelfProviderWarning = (
  provider: BookshelfProvider
): string | undefined =>
  provider === 'softcover'
    ? 'Legacy metadata backend. Hardcover is recommended for new installs.'
    : undefined;
