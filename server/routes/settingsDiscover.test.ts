import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import { DiscoverSliderType } from '@server/constants/discover';
import { getRepository } from '@server/datasource';
import DiscoverSlider from '@server/entity/DiscoverSlider';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import discoverSettingRoutes from './settings/discover';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/settings/discover', discoverSettingRoutes);
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

afterEach(() => {
  mock.restoreAll();
});

setupTestDb();

const customSliderPayload = {
  data: 'jazz',
  title: 'Jazz',
  type: DiscoverSliderType.MUSICBRAINZ_MUSIC_GENRE,
};

describe('Discover settings route validation', () => {
  it('rejects malformed slider arrays before lookup', async () => {
    const res = await request(app)
      .post('/settings/discover')
      .send([customSliderPayload, null]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Slider must be an object/);
  });

  it('rejects malformed create slider bodies', async () => {
    const res = await request(app).post('/settings/discover/add').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Slider must be an object/);
  });

  it('rejects malformed update slider bodies', async () => {
    const slider = await getRepository(DiscoverSlider).save(
      new DiscoverSlider({
        data: 'fiction',
        enabled: false,
        isBuiltIn: false,
        order: -1,
        title: 'Fiction',
        type: DiscoverSliderType.OPENLIBRARY_BOOK_SUBJECT,
      })
    );
    const res = await request(app)
      .put(`/settings/discover/${slider.id}`)
      .send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Slider must be an object/);
  });

  it('rejects malformed slider update IDs before validation and lookup', async () => {
    const res = await request(app)
      .put('/settings/discover/not-a-number')
      .send(customSliderPayload);

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed slider delete IDs before lookup', async () => {
    const res = await request(app).delete('/settings/discover/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('updates a custom slider using a parsed positive route ID', async () => {
    const slider = await getRepository(DiscoverSlider).save(
      new DiscoverSlider({
        data: 'fiction',
        enabled: false,
        isBuiltIn: false,
        order: -1,
        title: 'Fiction',
        type: DiscoverSliderType.OPENLIBRARY_BOOK_SUBJECT,
      })
    );

    const res = await request(app)
      .put(`/settings/discover/${slider.id}`)
      .send(customSliderPayload);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data, 'jazz');
    assert.strictEqual(res.body.title, 'Jazz');
  });
});
