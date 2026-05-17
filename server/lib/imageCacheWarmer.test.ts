import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getImageCacheWarmPath,
  getImageCacheWarmProvider,
} from './imageCacheWarmer';

describe('getImageCacheWarmProvider', () => {
  it('maps all proxied image providers to warmable cache providers', () => {
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://image.tmdb.org/t/p/w300/poster.jpg')
      ),
      'tmdb'
    );
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://artworks.thetvdb.com/banners/poster.jpg')
      ),
      'tvdb'
    );
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://coverartarchive.org/release/id/front-250')
      ),
      'coverartarchive'
    );
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://archive.org/download/artist/thumb.jpg')
      ),
      'archiveorg'
    );
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://covers.openlibrary.org/b/id/123-L.jpg')
      ),
      'openlibrarycovers'
    );
  });

  it('ignores unsupported image providers', () => {
    assert.equal(
      getImageCacheWarmProvider(new URL('https://example.com/image.jpg')),
      null
    );
  });
});

describe('getImageCacheWarmPath', () => {
  it('keeps query strings aligned with image proxy cache keys', () => {
    assert.equal(
      getImageCacheWarmPath(
        new URL('https://image.tmdb.org/t/p/w300/poster.jpg?version=2&lang=en')
      ),
      '/t/p/w300/poster.jpg?version=2&lang=en'
    );
  });
});
