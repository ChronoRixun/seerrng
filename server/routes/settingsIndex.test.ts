import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import { getSettings } from '@server/lib/settings';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import settingsRoutes from './settings';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/settings', settingsRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(() => {
  app = createApp();
});

beforeEach(() => {
  const settings = getSettings();
  settings.plex.libraries = [
    { id: '1', name: 'Movies', enabled: false, type: 'movie' },
  ];
  settings.jellyfin.libraries = [
    { id: '2', name: 'Shows', enabled: false, type: 'show' },
  ];
  mock.method(settings, 'save', async () => undefined);
});

afterEach(() => {
  mock.restoreAll();
});

describe('Settings route input validation', () => {
  it('rejects array Plex library enable queries instead of throwing', async () => {
    const res = await request(app)
      .get('/settings/plex/library')
      .query({ enable: ['1', '2'] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(getSettings().plex.libraries[0].enabled, false);
  });

  it('rejects non-boolean Plex library sync flags', async () => {
    const res = await request(app)
      .get('/settings/plex/library')
      .query({ sync: 'yes' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sync must be valid/);
  });

  it('rejects array Jellyfin library enable queries instead of throwing', async () => {
    const res = await request(app)
      .get('/settings/jellyfin/library')
      .query({ enable: ['1', '2'] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(getSettings().jellyfin.libraries[0].enabled, false);
  });

  it('rejects non-boolean Jellyfin library sync flags', async () => {
    const res = await request(app)
      .get('/settings/jellyfin/library')
      .query({ sync: 'yes' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sync must be valid/);
  });

  it('rejects string scanner commands', async () => {
    const plexRes = await request(app)
      .post('/settings/plex/sync')
      .send({ start: 'true' });
    const jellyfinRes = await request(app)
      .post('/settings/jellyfin/sync')
      .send({ cancel: 'true' });

    assert.strictEqual(plexRes.status, 400);
    assert.match(plexRes.body.message, /Start must be a boolean/);
    assert.strictEqual(jellyfinRes.status, 400);
    assert.match(jellyfinRes.body.message, /Cancel must be a boolean/);
  });

  it('rejects oversized job IDs before lookup', async () => {
    const res = await request(app).post(`/settings/jobs/${'x'.repeat(129)}/run`);

    assert.strictEqual(res.status, 404);
  });

  it('rejects oversized cache IDs before lookup', async () => {
    const res = await request(app).post(
      `/settings/cache/${'x'.repeat(129)}/flush`
    );

    assert.strictEqual(res.status, 404);
  });
});
