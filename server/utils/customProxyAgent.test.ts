import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { ProxySettings } from '@server/lib/settings';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import createCustomProxyAgent, {
  PROXY_CONNECTIVITY_CHECK_OPTIONS,
  requestInterceptorFunction,
} from './customProxyAgent';

const proxySettings: ProxySettings = {
  enabled: true,
  hostname: 'proxy.example.com',
  port: 8080,
  useSsl: false,
  user: '',
  password: '',
  bypassFilter: '',
  bypassLocalAddresses: true,
};

afterEach(() => {
  mock.restoreAll();
});

describe('requestInterceptorFunction', () => {
  it('bounds the proxy connectivity probe', () => {
    assert.equal(PROXY_CONNECTIVITY_CHECK_OPTIONS.timeout, 5_000);
    assert.equal(PROXY_CONNECTIVITY_CHECK_OPTIONS.maxContentLength, 1024);
    assert.equal(PROXY_CONNECTIVITY_CHECK_OPTIONS.maxBodyLength, 1024);
  });

  it('is safe to register before proxy initialization', () => {
    const config = { url: 'https://example.com' } as InternalAxiosRequestConfig;

    assert.equal(requestInterceptorFunction(config), config);
  });

  it('bypasses the proxy for absolute local URLs even with a base URL', async () => {
    const head = mock.method(axios, 'head', async () => ({ status: 200 }));
    await createCustomProxyAgent(proxySettings);

    assert.equal(head.mock.callCount(), 1);
    assert.deepEqual(head.mock.calls[0].arguments, [
      'https://www.google.com',
      PROXY_CONNECTIVITY_CHECK_OPTIONS,
    ]);

    const config = requestInterceptorFunction({
      baseURL: 'https://api.example.com/v1',
      url: 'http://127.0.0.1/status',
    } as InternalAxiosRequestConfig);

    assert.equal(config.httpAgent, false);
    assert.equal(config.httpsAgent, false);
  });
});
