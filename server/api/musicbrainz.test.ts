import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WIKIPEDIA_EXTRACT_HTTP_OPTIONS } from './musicbrainz';

describe('WIKIPEDIA_EXTRACT_HTTP_OPTIONS', () => {
  it('bounds MusicBrainz Wikipedia extract requests', () => {
    assert.equal(WIKIPEDIA_EXTRACT_HTTP_OPTIONS.timeout, 10_000);
    assert.equal(WIKIPEDIA_EXTRACT_HTTP_OPTIONS.maxRedirects, 3);
    assert.equal(WIKIPEDIA_EXTRACT_HTTP_OPTIONS.maxContentLength, 256 * 1024);
    assert.equal(WIKIPEDIA_EXTRACT_HTTP_OPTIONS.maxBodyLength, 1024);
  });
});
