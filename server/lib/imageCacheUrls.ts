type ImageWarmableRecord = {
  mediaType?: unknown;
  posterPath?: unknown;
  remotePoster?: unknown;
  backdropPath?: unknown;
  profilePath?: unknown;
  artistThumb?: unknown;
  artistBackdrop?: unknown;
};

const TMDB_POSTER_TYPES = new Set(['movie', 'tv', 'person', 'collection']);
const TMDB_BACKDROP_TYPES = new Set(['movie', 'tv', 'collection']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getTmdbImageUrl = (path: string, size: string): string =>
  `https://image.tmdb.org/t/p/${size}${path}`;

const normalizeExternalImageUrl = (path: unknown): string | null => {
  if (typeof path !== 'string' || !path.startsWith('http')) {
    return null;
  }

  return path;
};

const getWarmableImageUrls = (item: ImageWarmableRecord): string[] => {
  const urls: (string | null)[] = [];
  const mediaType = typeof item.mediaType === 'string' ? item.mediaType : '';

  if (typeof item.posterPath === 'string') {
    if (TMDB_POSTER_TYPES.has(mediaType) && item.posterPath.startsWith('/')) {
      urls.push(getTmdbImageUrl(item.posterPath, 'w300_and_h450_face'));
    } else {
      urls.push(normalizeExternalImageUrl(item.posterPath));
    }
  }

  urls.push(normalizeExternalImageUrl(item.remotePoster));

  if (
    typeof item.backdropPath === 'string' &&
    TMDB_BACKDROP_TYPES.has(mediaType) &&
    item.backdropPath.startsWith('/')
  ) {
    urls.push(getTmdbImageUrl(item.backdropPath, 'w1920_and_h800_multi_faces'));
  }

  if (typeof item.profilePath === 'string') {
    urls.push(
      item.profilePath.startsWith('/')
        ? getTmdbImageUrl(item.profilePath, 'w600_and_h900_bestv2')
        : normalizeExternalImageUrl(item.profilePath)
    );
  }

  urls.push(
    normalizeExternalImageUrl(item.artistThumb),
    normalizeExternalImageUrl(item.artistBackdrop)
  );

  return urls.filter((url): url is string => !!url);
};

export const extractImageCacheUrls = (body: unknown): string[] => {
  const urls = new Set<string>();
  const seen = new Set<unknown>();

  const visit = (value: unknown) => {
    if (!value || seen.has(value)) {
      return;
    }

    if (Array.isArray(value)) {
      seen.add(value);
      value.forEach(visit);
      return;
    }

    if (!isRecord(value)) {
      return;
    }

    seen.add(value);
    getWarmableImageUrls(value).forEach((url) => urls.add(url));
    Object.values(value).forEach(visit);
  };

  visit(body);

  return [...urls];
};
