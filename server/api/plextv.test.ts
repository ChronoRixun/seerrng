import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLEXTV_HTTP_OPTIONS } from './plextv';

describe('PLEXTV_HTTP_OPTIONS', () => {
  it('bounds outbound Plex.tv requests', () => {
    assert.equal(PLEXTV_HTTP_OPTIONS.timeout, 10_000);
    assert.equal(PLEXTV_HTTP_OPTIONS.maxContentLength, 1024 * 1024);
    assert.equal(PLEXTV_HTTP_OPTIONS.maxBodyLength, 1024);
  });
});
