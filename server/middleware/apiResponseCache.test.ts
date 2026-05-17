import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import express from 'express';
import request from 'supertest';
import { apiResponseCache } from './apiResponseCache';

const createApp = (authenticated = true) => {
  const app = express();

  app.use((req, _res, next) => {
    if (authenticated) {
      req.user = { id: 1 } as NonNullable<typeof req.user>;
    }
    next();
  });
  app.use(apiResponseCache);
  app.get('/discover/books', (_req, res) => res.json({ results: [] }));
  app.get('/book/OL1W', (_req, res) => res.json({ id: 'OL1W' }));
  app.get('/settings/public', (_req, res) => res.json({ initialized: true }));
  app.get('/request/count', (_req, res) => res.json({ pending: 0 }));
  app.get('/discover/fails', (_req, res) =>
    res.status(500).json({ message: 'failed' })
  );

  return app;
};

describe('apiResponseCache', () => {
  it('marks authenticated discover responses as private browser-cacheable', async () => {
    const res = await request(createApp()).get('/discover/books');

    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /private/);
    assert.match(res.headers['cache-control'], /max-age=900/);
    assert.equal(res.headers.vary, 'Cookie, Accept-Encoding');
  });

  it('uses a shorter private cache for media details', async () => {
    const res = await request(createApp()).get('/book/OL1W');

    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /private/);
    assert.match(res.headers['cache-control'], /max-age=300/);
  });

  it('allows public settings to be cached without authentication', async () => {
    const res = await request(createApp(false)).get('/settings/public');

    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /public/);
  });

  it('does not cache errors or unrelated operational routes', async () => {
    const app = createApp();
    const [failure, requestCount] = await Promise.all([
      request(app).get('/discover/fails'),
      request(app).get('/request/count'),
    ]);

    assert.equal(failure.status, 500);
    assert.equal(failure.headers['cache-control'], undefined);
    assert.equal(requestCount.status, 200);
    assert.equal(requestCount.headers['cache-control'], undefined);
  });
});
