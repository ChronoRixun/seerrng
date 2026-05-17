import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServiceUrl, normalizeUrlBase } from './serviceUrl';

describe('normalizeUrlBase', () => {
  it('normalizes relative url bases', () => {
    assert.equal(normalizeUrlBase('sonarr'), '/sonarr');
    assert.equal(normalizeUrlBase('/sonarr/'), '/sonarr');
    assert.equal(normalizeUrlBase(''), '');
  });

  it('rejects absolute, protocol-relative, and query-like url bases', () => {
    assert.equal(normalizeUrlBase('https://example.com'), '');
    assert.equal(normalizeUrlBase('//example.com'), '');
    assert.equal(normalizeUrlBase('/sonarr?x=1'), '');
    assert.equal(normalizeUrlBase('/sonarr#fragment'), '');
    assert.equal(normalizeUrlBase('/sonarr\r\nx-header: injected'), '');
  });
});

describe('buildServiceUrl', () => {
  it('builds normalized service URLs', () => {
    assert.equal(
      buildServiceUrl({
        useSsl: true,
        hostname: 'media.local',
        port: 8989,
        urlBase: 'sonarr/',
        path: '/api/v3',
      }),
      'https://media.local:8989/sonarr/api/v3'
    );
  });
});
