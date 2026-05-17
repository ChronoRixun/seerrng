import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { getInternalApiBaseUrl } from './internalApi';

const originalHost = process.env.HOST;
const originalPort = process.env.PORT;

afterEach(() => {
  process.env.HOST = originalHost;
  process.env.PORT = originalPort;
});

describe('getInternalApiBaseUrl', () => {
  it('uses loopback when HOST is not set', () => {
    delete process.env.HOST;
    delete process.env.PORT;

    assert.equal(getInternalApiBaseUrl(), 'http://127.0.0.1:5055');
  });

  it('does not use bind-all hosts for internal requests', () => {
    process.env.HOST = '0.0.0.0';
    process.env.PORT = '8080';

    assert.equal(getInternalApiBaseUrl(), 'http://127.0.0.1:8080');

    process.env.HOST = '::';

    assert.equal(getInternalApiBaseUrl(), 'http://127.0.0.1:8080');
  });

  it('brackets IPv6 hosts', () => {
    process.env.HOST = 'fd00::1';
    process.env.PORT = '8080';

    assert.equal(getInternalApiBaseUrl(), 'http://[fd00::1]:8080');
  });
});
