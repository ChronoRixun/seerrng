import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getImageCacheUrl, isRemoteAvatarCacheUrlAllowed } from './imageCache';

describe('getImageCacheUrl', () => {
  it('rewrites supported image providers when image caching is enabled', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://image.tmdb.org/t/p/w300/poster.jpg',
        type: 'tmdb',
      }),
      '/imageproxy/tmdb/t/p/w300/poster.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://artworks.thetvdb.com/banners/poster.jpg',
        type: 'tvdb',
      }),
      '/imageproxy/tvdb/banners/poster.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://covers.openlibrary.org/b/id/123-L.jpg',
        type: 'book',
      }),
      '/imageproxy/openlibrarycovers/b/id/123-L.jpg'
    );
  });

  it('rewrites supported image providers by URL even when the type is generic', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://covers.openlibrary.org/b/id/123-L.jpg',
        type: 'tmdb',
      }),
      '/imageproxy/openlibrarycovers/b/id/123-L.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://coverartarchive.org/release/id/front-250',
        type: 'tmdb',
      }),
      '/imageproxy/coverartarchive/release/id/front-250'
    );
  });

  it('rewrites music provider variants', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://coverartarchive.org/release/id/front-250',
        type: 'music',
      }),
      '/imageproxy/coverartarchive/release/id/front-250'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://archive.org/download/artist/thumb.jpg',
        type: 'music',
      }),
      '/imageproxy/archiveorg/download/artist/thumb.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://r2.theaudiodb.com/images/media/artist/thumb.jpg',
        type: 'music',
      }),
      '/imageproxy/theaudiodb/images/media/artist/thumb.jpg'
    );
  });

  it('rewrites allowlisted remote avatar URLs', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://secure.gravatar.com/avatar/abc?d=mm',
        type: 'avatar',
      }),
      '/avatarproxy/remote?url=https%3A%2F%2Fsecure.gravatar.com%2Favatar%2Fabc%3Fd%3Dmm'
    );
  });

  it('leaves local, disabled, and unsupported URLs untouched', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: '/images/local.png',
        type: 'tmdb',
      }),
      '/images/local.png'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: false,
        src: 'https://image.tmdb.org/t/p/w300/poster.jpg',
        type: 'tmdb',
      }),
      'https://image.tmdb.org/t/p/w300/poster.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://example.com/avatar.png',
        type: 'avatar',
      }),
      'https://example.com/avatar.png'
    );
  });
});

describe('isRemoteAvatarCacheUrlAllowed', () => {
  it('accepts only safe avatar provider URLs', () => {
    assert.equal(
      isRemoteAvatarCacheUrlAllowed('https://images.plex.tv/users/1/avatar'),
      true
    );
    assert.equal(
      isRemoteAvatarCacheUrlAllowed('http://images.plex.tv/users/1/avatar'),
      false
    );
    assert.equal(
      isRemoteAvatarCacheUrlAllowed('https://example.com/avatar.png'),
      false
    );
  });
});
