import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getImageCacheLastModified,
  getImageResponseContentType,
  parseCacheControlMaxAge,
} from './imageproxy';

describe('parseCacheControlMaxAge', () => {
  it('parses standard comma-delimited cache-control headers', () => {
    assert.equal(
      parseCacheControlMaxAge('public, max-age=31536000, immutable'),
      31536000
    );
  });

  it('parses max-age regardless of casing and spacing', () => {
    assert.equal(parseCacheControlMaxAge('PRIVATE,  MAX-AGE=7200'), 7200);
  });

  it('falls back to one day when max-age is missing or invalid', () => {
    assert.equal(parseCacheControlMaxAge(undefined), 86400);
    assert.equal(parseCacheControlMaxAge('no-cache'), 86400);
    assert.equal(parseCacheControlMaxAge('public, max-age=0'), 86400);
  });
});

describe('getImageCacheLastModified', () => {
  it('derives last-modified from valid cache filename metadata', () => {
    assert.equal(getImageCacheLastModified(200000, 100, 12345), 100000);
  });

  it('falls back to now for invalid cache filename metadata', () => {
    assert.equal(getImageCacheLastModified(Number.NaN, 100, 12345), 12345);
    assert.equal(getImageCacheLastModified(200000, 0, 12345), 12345);
  });
});

describe('getImageResponseContentType', () => {
  it('uses canonical MIME types for cached image extensions', () => {
    assert.equal(getImageResponseContentType('jpg'), 'image/jpeg');
    assert.equal(getImageResponseContentType('jpeg'), 'image/jpeg');
    assert.equal(getImageResponseContentType('svg'), 'image/svg+xml');
    assert.equal(getImageResponseContentType('webp'), 'image/webp');
  });

  it('falls back safely for unknown or missing extensions', () => {
    assert.equal(getImageResponseContentType('custom'), 'image/custom');
    assert.equal(getImageResponseContentType(null), 'application/octet-stream');
  });
});
