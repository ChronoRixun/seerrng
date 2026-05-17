import ImageProxy from '@server/lib/imageproxy';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

const warmBatchSize = 8;
const maxWarmUrls = 80;

const tmdbImageProxy = new ImageProxy('tmdb', 'https://image.tmdb.org', {
  rateLimitOptions: {
    maxRequests: 10,
    maxRPS: 20,
  },
});
const tvdbImageProxy = new ImageProxy('tvdb', 'https://artworks.thetvdb.com', {
  rateLimitOptions: {
    maxRequests: 10,
    maxRPS: 20,
  },
});
const coverArtArchiveImageProxy = new ImageProxy(
  'coverartarchive',
  'https://coverartarchive.org',
  {
    rateLimitOptions: {
      maxRequests: 5,
      maxRPS: 10,
    },
  }
);
const archiveOrgImageProxy = new ImageProxy(
  'archiveorg',
  'https://archive.org',
  {
    rateLimitOptions: {
      maxRequests: 5,
      maxRPS: 10,
    },
  }
);
const theAudioDbImageProxy = new ImageProxy(
  'theaudiodb',
  'https://www.theaudiodb.com',
  {
    rateLimitOptions: {
      maxRequests: 5,
      maxRPS: 10,
    },
  }
);
const openLibraryCoversImageProxy = new ImageProxy(
  'openlibrarycovers',
  'https://covers.openlibrary.org',
  {
    rateLimitOptions: {
      maxRequests: 5,
      maxRPS: 10,
    },
  }
);

export const getImageCacheWarmProvider = (url: URL): string | null => {
  switch (url.origin) {
    case 'https://image.tmdb.org':
      return 'tmdb';
    case 'https://artworks.thetvdb.com':
      return 'tvdb';
    case 'https://coverartarchive.org':
      return 'coverartarchive';
    case 'https://archive.org':
      return 'archiveorg';
    case 'https://www.theaudiodb.com':
      return 'theaudiodb';
    case 'https://covers.openlibrary.org':
      return 'openlibrarycovers';
    default:
      return null;
  }
};

export const getImageCacheWarmPath = (url: URL): string =>
  `${url.pathname}${url.search}`;

const getProxyForUrl = (url: URL): ImageProxy | null => {
  const provider = getImageCacheWarmProvider(url);

  switch (provider) {
    case 'tmdb':
      return tmdbImageProxy;
    case 'tvdb':
      return tvdbImageProxy;
    case 'coverartarchive':
      return coverArtArchiveImageProxy;
    case 'archiveorg':
      return archiveOrgImageProxy;
    case 'theaudiodb':
      return theAudioDbImageProxy;
    case 'openlibrarycovers':
      return openLibraryCoversImageProxy;
    default:
      return null;
  }
};

const warmUrl = async (rawUrl: string) => {
  const url = new URL(rawUrl);
  const proxy = getProxyForUrl(url);

  if (!proxy) {
    return;
  }

  await proxy.getImage(getImageCacheWarmPath(url));
};

export const enqueueImageCacheWarm = (urls: string[]) => {
  if (!getSettings().main.cacheImages) {
    return;
  }

  const uniqueUrls = [...new Set(urls)]
    .filter((url) => url.startsWith('https://'))
    .slice(0, maxWarmUrls);

  if (!uniqueUrls.length) {
    return;
  }

  setImmediate(async () => {
    for (let i = 0; i < uniqueUrls.length; i += warmBatchSize) {
      const batch = uniqueUrls.slice(i, i + warmBatchSize);

      await Promise.allSettled(batch.map((url) => warmUrl(url)));
    }

    logger.debug(`Queued ${uniqueUrls.length} image(s) for cache warming`, {
      label: 'Image Cache',
    });
  });
};
