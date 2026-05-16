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

const getProxyForUrl = (url: URL): ImageProxy | null => {
  if (url.origin === 'https://image.tmdb.org') {
    return tmdbImageProxy;
  }

  if (url.origin === 'https://coverartarchive.org') {
    return coverArtArchiveImageProxy;
  }

  if (url.origin === 'https://archive.org') {
    return archiveOrgImageProxy;
  }

  if (url.origin === 'https://covers.openlibrary.org') {
    return openLibraryCoversImageProxy;
  }

  return null;
};

const warmUrl = async (rawUrl: string) => {
  const url = new URL(rawUrl);
  const proxy = getProxyForUrl(url);

  if (!proxy) {
    return;
  }

  await proxy.getImage(`${url.pathname}${url.search}`);
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
