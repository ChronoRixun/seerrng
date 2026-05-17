import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePositiveRouteId } from './routeId';

describe('parsePositiveRouteId', () => {
  it('accepts positive decimal integer route ids', () => {
    assert.equal(parsePositiveRouteId('1'), 1);
    assert.equal(parsePositiveRouteId(2), 2);
  });

  it('rejects non-decimal, non-integer, empty, array, and out-of-range ids', () => {
    assert.equal(parsePositiveRouteId(''), undefined);
    assert.equal(parsePositiveRouteId(' 1 '), undefined);
    assert.equal(parsePositiveRouteId('1.5'), undefined);
    assert.equal(parsePositiveRouteId('1e2'), undefined);
    assert.equal(parsePositiveRouteId('0x10'), undefined);
    assert.equal(parsePositiveRouteId(['1']), undefined);
    assert.equal(parsePositiveRouteId('0'), undefined);
    assert.equal(parsePositiveRouteId('11', 10), undefined);
  });
});
