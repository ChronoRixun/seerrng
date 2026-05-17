import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NOTIFICATION_HTTP_OPTIONS } from './agent';

describe('NOTIFICATION_HTTP_OPTIONS', () => {
  it('bounds outbound notification HTTP requests', () => {
    assert.equal(NOTIFICATION_HTTP_OPTIONS.timeout, 10_000);
    assert.equal(NOTIFICATION_HTTP_OPTIONS.maxBodyLength, 128 * 1024);
    assert.equal(NOTIFICATION_HTTP_OPTIONS.maxContentLength, 128 * 1024);
  });
});
