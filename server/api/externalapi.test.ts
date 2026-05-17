import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createExternalApiCacheKeySuffix } from './externalapi';

describe('createExternalApiCacheKeySuffix', () => {
  it('uses a stable digest for equivalent option objects', () => {
    const first = createExternalApiCacheKeySuffix({
      headers: { 'X-Api-Key': 'key', Accept: 'application/json' },
      query: { b: 2, a: 1 },
    });
    const second = createExternalApiCacheKeySuffix({
      query: { a: 1, b: 2 },
      headers: { Accept: 'application/json', 'X-Api-Key': 'key' },
    });

    assert.equal(first, second);
  });

  it('keeps cache keys bounded and avoids retaining raw request options', () => {
    const secret = `token-${'x'.repeat(20_000)}`;
    const suffix = createExternalApiCacheKeySuffix({
      headers: { Authorization: `Bearer ${secret}` },
    });

    assert.match(suffix, /^:sha256:[a-f0-9]{64}$/);
    assert.equal(suffix.includes(secret), false);
  });

  it('does not throw on circular option objects', () => {
    const options: Record<string, unknown> = {};
    options.self = options;

    assert.match(createExternalApiCacheKeySuffix(options), /^:sha256:/);
  });
});
