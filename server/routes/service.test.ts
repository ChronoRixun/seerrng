import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import type { LidarrSettings, ReadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import serviceRoutes from './service';
import lidarrRoutes from './settings/lidarr';
import readarrRoutes from './settings/readarr';

let app: Express;

const baseServerSettings = {
  hostname: 'localhost',
  apiKey: 'test-key',
  useSsl: false,
  activeProfileId: 1,
  activeProfileName: 'Any',
  activeDirectory: '/data',
  tags: [10],
  is4k: false,
  syncEnabled: true,
  preventSearch: false,
  tagRequests: false,
  overrideRule: [],
  externalUrl: '',
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/service', serviceRoutes);
  app.use('/settings/lidarr', lidarrRoutes);
  app.use('/settings/readarr', readarrRoutes);
  app.use(
    (
      err: { status?: number | string; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(Number(err.status ?? 500))
        .json({ status: Number(err.status ?? 500), message: err.message });
    }
  );
  return app;
}

function makeLidarr(overrides: Partial<LidarrSettings> = {}): LidarrSettings {
  return {
    ...baseServerSettings,
    id: overrides.id ?? 0,
    name: 'Lidarr',
    port: 8686,
    activeMetadataProfileId: 2,
    activeMetadataProfileName: 'Standard',
    isDefault: true,
    ...overrides,
  };
}

function makeReadarr(
  overrides: Partial<ReadarrSettings> = {}
): ReadarrSettings {
  return {
    ...baseServerSettings,
    id: overrides.id ?? 0,
    name: 'Bookshelf',
    port: 8787,
    activeMetadataProfileId: 2,
    activeMetadataProfileName: 'Standard',
    isDefault: true,
    serviceType: 'ebook',
    ...overrides,
  };
}

before(() => {
  app = createApp();
});

beforeEach(() => {
  const settings = getSettings();
  settings.lidarr = [];
  settings.readarr = [];
  mock.method(settings, 'save', async () => undefined);
});

afterEach(() => {
  mock.restoreAll();
});

describe('Lidarr settings routes', () => {
  it('keeps only the newest default Lidarr server active', async () => {
    const first = await request(app)
      .post('/settings/lidarr')
      .send(makeLidarr({ name: 'Primary Lidarr', isDefault: true }));
    const second = await request(app)
      .post('/settings/lidarr')
      .send(makeLidarr({ name: 'Replacement Lidarr', isDefault: true }));

    assert.strictEqual(first.status, 201);
    assert.strictEqual(second.status, 201);

    const servers = getSettings().lidarr;
    assert.deepStrictEqual(
      servers.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
      [
        { id: 0, name: 'Primary Lidarr', isDefault: false },
        { id: 1, name: 'Replacement Lidarr', isDefault: true },
      ]
    );
  });

  it('returns Lidarr service summaries with metadata profile and tags', async () => {
    getSettings().lidarr = [
      makeLidarr({
        id: 4,
        name: 'Music Backend',
        activeDirectory: '/music',
        activeProfileId: 11,
        activeMetadataProfileId: 22,
        tags: [3, 5],
      }),
    ];

    const res = await request(app).get('/service/lidarr');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, [
      {
        id: 4,
        name: 'Music Backend',
        is4k: false,
        isDefault: true,
        activeDirectory: '/music',
        activeProfileId: 11,
        activeMetadataProfileId: 22,
        activeTags: [3, 5],
      },
    ]);
  });
});

describe('Bookshelf settings routes', () => {
  it('keeps separate default Bookshelf servers per book format', async () => {
    const first = await request(app)
      .post('/settings/readarr')
      .send(makeReadarr({ name: 'Primary Bookshelf', isDefault: true }));
    const second = await request(app)
      .post('/settings/readarr')
      .send(
        makeReadarr({
          name: 'Replacement Bookshelf',
          isDefault: true,
          serviceType: 'audiobook',
        })
      );

    assert.strictEqual(first.status, 201);
    assert.strictEqual(second.status, 201);

    const servers = getSettings().readarr;
    assert.deepStrictEqual(
      servers.map(({ id, name, isDefault, serviceType }) => ({
        id,
        name,
        isDefault,
        serviceType,
      })),
      [
        {
          id: 0,
          name: 'Primary Bookshelf',
          isDefault: true,
          serviceType: 'ebook',
        },
        {
          id: 1,
          name: 'Replacement Bookshelf',
          isDefault: true,
          serviceType: 'audiobook',
        },
      ]
    );
  });

  it('keeps only the newest default Bookshelf server active for the same format', async () => {
    const first = await request(app)
      .post('/settings/readarr')
      .send(makeReadarr({ name: 'Primary Ebook Bookshelf', isDefault: true }));
    const second = await request(app)
      .post('/settings/readarr')
      .send(
        makeReadarr({
          name: 'Replacement Ebook Bookshelf',
          isDefault: true,
          serviceType: 'ebook',
        })
      );

    assert.strictEqual(first.status, 201);
    assert.strictEqual(second.status, 201);

    const servers = getSettings().readarr;
    assert.deepStrictEqual(
      servers.map(({ id, name, isDefault, serviceType }) => ({
        id,
        name,
        isDefault,
        serviceType,
      })),
      [
        {
          id: 0,
          name: 'Primary Ebook Bookshelf',
          isDefault: false,
          serviceType: 'ebook',
        },
        {
          id: 1,
          name: 'Replacement Ebook Bookshelf',
          isDefault: true,
          serviceType: 'ebook',
        },
      ]
    );
  });

  it('returns Bookshelf/Readarr service summaries with metadata profile and tags', async () => {
    getSettings().readarr = [
      makeReadarr({
        id: 7,
        name: 'Books Backend',
        activeDirectory: '/books',
        activeProfileId: 12,
        activeMetadataProfileId: 23,
        tags: [8, 13],
      }),
    ];

    const res = await request(app).get('/service/readarr');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, [
      {
        id: 7,
        name: 'Books Backend',
        is4k: false,
        isDefault: true,
        activeDirectory: '/books',
        activeProfileId: 12,
        activeMetadataProfileId: 23,
        activeTags: [8, 13],
      },
    ]);
  });
});
