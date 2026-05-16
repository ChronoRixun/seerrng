import { enqueueImageCacheWarm } from '@server/lib/imageCacheWarmer';
import ImageProxy from '@server/lib/imageproxy';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();

// Delay the initialization of ImageProxy instances until the proxy (if any) is properly configured
let _tmdbImageProxy: ImageProxy;
function initTmdbImageProxy() {
  if (!_tmdbImageProxy) {
    _tmdbImageProxy = new ImageProxy('tmdb', 'https://image.tmdb.org', {
      rateLimitOptions: {
        maxRequests: 20,
        maxRPS: 50,
      },
    });
  }
  return _tmdbImageProxy;
}
let _tvdbImageProxy: ImageProxy;
function initTvdbImageProxy() {
  if (!_tvdbImageProxy) {
    _tvdbImageProxy = new ImageProxy('tvdb', 'https://artworks.thetvdb.com', {
      rateLimitOptions: {
        maxRequests: 20,
        maxRPS: 50,
      },
    });
  }
  return _tvdbImageProxy;
}
let _coverArtArchiveImageProxy: ImageProxy;
function initCoverArtArchiveImageProxy() {
  if (!_coverArtArchiveImageProxy) {
    _coverArtArchiveImageProxy = new ImageProxy(
      'coverartarchive',
      'https://coverartarchive.org',
      {
        rateLimitOptions: {
          maxRequests: 10,
          maxRPS: 20,
        },
      }
    );
  }
  return _coverArtArchiveImageProxy;
}
let _archiveOrgImageProxy: ImageProxy;
function initArchiveOrgImageProxy() {
  if (!_archiveOrgImageProxy) {
    _archiveOrgImageProxy = new ImageProxy(
      'archiveorg',
      'https://archive.org',
      {
        rateLimitOptions: {
          maxRequests: 10,
          maxRPS: 20,
        },
      }
    );
  }
  return _archiveOrgImageProxy;
}
let _openLibraryCoversImageProxy: ImageProxy;
function initOpenLibraryCoversImageProxy() {
  if (!_openLibraryCoversImageProxy) {
    _openLibraryCoversImageProxy = new ImageProxy(
      'openlibrarycovers',
      'https://covers.openlibrary.org',
      {
        rateLimitOptions: {
          maxRequests: 10,
          maxRPS: 20,
        },
      }
    );
  }
  return _openLibraryCoversImageProxy;
}

router.get<{
  type: string;
  path: string[];
}>('/:type/*path', async (req, res) => {
  const imagePath = '/' + req.params.path.join('/');

  if (imagePath.startsWith('//') || imagePath.includes('://')) {
    logger.error('Invalid URL for image proxy', { imagePath });
    return res.status(403).send('Invalid URL for image proxy');
  }

  try {
    let imageData;
    if (req.params.type === 'tmdb') {
      imageData = await initTmdbImageProxy().getImage(imagePath);
    } else if (req.params.type === 'tvdb') {
      imageData = await initTvdbImageProxy().getImage(imagePath);
    } else if (req.params.type === 'coverartarchive') {
      imageData = await initCoverArtArchiveImageProxy().getImage(imagePath);
    } else if (req.params.type === 'archiveorg') {
      imageData = await initArchiveOrgImageProxy().getImage(imagePath);
    } else if (req.params.type === 'openlibrarycovers') {
      imageData = await initOpenLibraryCoversImageProxy().getImage(imagePath);
    } else {
      logger.error('Unsupported image type', {
        imagePath,
        type: req.params.type,
      });
      res.status(400).send('Unsupported image type');
      return;
    }

    res.writeHead(200, {
      'Content-Type': `image/${imageData.meta.extension}`,
      'Content-Length': imageData.imageBuffer.length,
      'Cache-Control': `public, max-age=${imageData.meta.curRevalidate}`,
      'OS-Cache-Key': imageData.meta.cacheKey,
      'OS-Cache-Status': imageData.meta.cacheMiss ? 'MISS' : 'HIT',
    });

    res.end(imageData.imageBuffer);
  } catch (e) {
    logger.error('Failed to proxy image', {
      imagePath,
      errorMessage: e.message,
    });
    res.status(500).send();
  }
});

router.post('/warm', (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];

  enqueueImageCacheWarm(
    urls.filter((url: unknown): url is string => typeof url === 'string')
  );

  return res.status(202).json({ accepted: true });
});

export default router;
