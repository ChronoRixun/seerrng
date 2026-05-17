import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TAUTULLI_HTTP_LIMITS } from './tautulli';

describe('TAUTULLI_HTTP_LIMITS', () => {
  it('bounds outbound Tautulli requests', () => {
    assert.equal(TAUTULLI_HTTP_LIMITS.maxContentLength, 2 * 1024 * 1024);
    assert.equal(TAUTULLI_HTTP_LIMITS.maxBodyLength, 1024);
  });
});
