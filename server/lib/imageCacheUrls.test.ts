import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractImageCacheUrls } from './imageCacheUrls';

describe('extractImageCacheUrls', () => {
  it('extracts warmable image URLs from nested media responses', () => {
    const urls = extractImageCacheUrls({
      results: [
        {
          mediaType: 'movie',
          posterPath: '/movie.jpg',
          backdropPath: '/movie-backdrop.jpg',
        },
        {
          mediaType: 'album',
          posterPath:
            'https://coverartarchive.org/release/release-id/front-250',
        },
        {
          mediaType: 'book',
          posterPath: 'https://covers.openlibrary.org/b/id/123-L.jpg',
        },
      ],
      graph: {
        edges: [
          {
            node: {
              mediaType: 'artist',
              artistThumb: 'https://archive.org/download/artist/thumb.jpg',
              artistBackdrop:
                'https://archive.org/download/artist/backdrop.jpg',
            },
          },
          {
            node: {
              mediaType: 'person',
              profilePath: '/person.jpg',
            },
          },
        ],
      },
    });

    assert.deepEqual(urls, [
      'https://image.tmdb.org/t/p/w300_and_h450_face/movie.jpg',
      'https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/movie-backdrop.jpg',
      'https://coverartarchive.org/release/release-id/front-250',
      'https://covers.openlibrary.org/b/id/123-L.jpg',
      'https://archive.org/download/artist/thumb.jpg',
      'https://archive.org/download/artist/backdrop.jpg',
      'https://image.tmdb.org/t/p/w600_and_h900_bestv2/person.jpg',
    ]);
  });

  it('deduplicates URLs and ignores unsupported relative paths', () => {
    const urls = extractImageCacheUrls({
      results: [
        {
          mediaType: 'album',
          posterPath: '/not-a-provider-path.jpg',
        },
        {
          mediaType: 'tv',
          posterPath: '/same.jpg',
        },
        {
          mediaType: 'tv',
          posterPath: '/same.jpg',
        },
      ],
    });

    assert.deepEqual(urls, [
      'https://image.tmdb.org/t/p/w300_and_h450_face/same.jpg',
    ]);
  });
});
