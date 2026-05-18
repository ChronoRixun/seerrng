import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import ReadarrAPI from '@server/api/servarr/readarr';
import type { PermissionCheckOptions } from '@server/lib/permissions';
import { Permission } from '@server/lib/permissions';
import type {
  LidarrSettings,
  RadarrSettings,
  ReadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import serviceRoutes from './service';
import lidarrRoutes from './settings/lidarr';
import radarrRoutes from './settings/radarr';
import readarrRoutes from './settings/readarr';
import sonarrRoutes from './settings/sonarr';

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

function createApp(permissions = Permission.REQUEST_ADVANCED) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      hasPermission: (
        requiredPermissions: Permission | Permission[],
        options: PermissionCheckOptions = { type: 'and' }
      ) => {
        const values = Array.isArray(requiredPermissions)
          ? requiredPermissions
          : [requiredPermissions];

        return options.type === 'or'
          ? values.some((permission) => Boolean(permissions & permission))
          : values.every((permission) => Boolean(permissions & permission));
      },
    } as Express.Request['user'];
    next();
  });
  app.use('/service', serviceRoutes);
  app.use('/settings/radarr', radarrRoutes);
  app.use('/settings/sonarr', sonarrRoutes);
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

function makeRadarr(overrides: Partial<RadarrSettings> = {}): RadarrSettings {
  return {
    ...baseServerSettings,
    id: overrides.id ?? 0,
    name: 'Radarr',
    port: 7878,
    minimumAvailability: 'released',
    isDefault: true,
    ...overrides,
  };
}

function makeSonarr(overrides: Partial<SonarrSettings> = {}): SonarrSettings {
  return {
    ...baseServerSettings,
    id: overrides.id ?? 0,
    name: 'Sonarr',
    port: 8989,
    seriesType: 'standard',
    animeSeriesType: 'anime',
    enableSeasonFolders: true,
    monitorNewItems: 'all',
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
  settings.radarr = [];
  settings.sonarr = [];
  settings.lidarr = [];
  settings.readarr = [];
  mock.method(settings, 'save', async () => undefined);
});

afterEach(() => {
  mock.restoreAll();
});

describe('Radarr settings routes', () => {
  it('rejects malformed Radarr settings bodies', async () => {
    const res = await request(app).post('/settings/radarr').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /settings must be an object/i);
  });

  it('rejects malformed Servarr tag arrays before persistence', async () => {
    const nestedTagsRes = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ tags: [[2]] as unknown as number[] }));
    const decimalOverrideRuleRes = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ overrideRule: ['2.5'] as unknown as number[] }));

    assert.strictEqual(nestedTagsRes.status, 400);
    assert.match(nestedTagsRes.body.message, /tags contains an invalid value/i);
    assert.strictEqual(decimalOverrideRuleRes.status, 400);
    assert.match(
      decimalOverrideRuleRes.body.message,
      /overrideRule contains an invalid value/i
    );
    assert.strictEqual(getSettings().radarr.length, 0);
  });

  it('rejects unsafe external service URLs before persistence', async () => {
    const res = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ externalUrl: 'javascript:alert(1)' }));

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /externalUrl must be a valid HTTP URL/i);
    assert.strictEqual(getSettings().radarr.length, 0);
  });

  it('rejects malformed Servarr URL bases before persistence', async () => {
    const absoluteRes = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ baseUrl: 'https://evil.example/base' }));
    const queryRes = await request(app)
      .post('/settings/sonarr')
      .send(makeSonarr({ baseUrl: '/sonarr?redirect=1' }));
    const slashRes = await request(app)
      .post('/settings/lidarr')
      .send(makeLidarr({ baseUrl: '//evil.example/lidarr' }));

    assert.strictEqual(absoluteRes.status, 400);
    assert.match(absoluteRes.body.message, /baseUrl must be a relative path/i);
    assert.strictEqual(queryRes.status, 400);
    assert.match(queryRes.body.message, /baseUrl must be a relative path/i);
    assert.strictEqual(slashRes.status, 400);
    assert.match(slashRes.body.message, /baseUrl must be a relative path/i);
    assert.strictEqual(getSettings().radarr.length, 0);
    assert.strictEqual(getSettings().sonarr.length, 0);
    assert.strictEqual(getSettings().lidarr.length, 0);
  });

  it('normalizes valid Servarr URL bases before persistence', async () => {
    const res = await request(app)
      .post('/settings/readarr')
      .send(makeReadarr({ baseUrl: 'bookshelf/' }));

    assert.strictEqual(res.status, 201);
    assert.strictEqual(getSettings().readarr[0].baseUrl, '/bookshelf');
  });

  it('does not clear Radarr defaults for string boolean payloads', async () => {
    getSettings().radarr = [makeRadarr({ id: 3, name: 'Primary Radarr' })];

    const res = await request(app)
      .post('/settings/radarr')
      .send(
        makeRadarr({
          name: 'String Boolean Radarr',
          isDefault: 'true' as unknown as boolean,
          is4k: 'false' as unknown as boolean,
        })
      );

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(
      getSettings().radarr.map(({ name, isDefault, is4k }) => ({
        name,
        isDefault,
        is4k,
      })),
      [
        { name: 'Primary Radarr', isDefault: true, is4k: false },
        { name: 'String Boolean Radarr', isDefault: false, is4k: false },
      ]
    );
  });

  it('rejects malformed settings IDs before update lookup', async () => {
    getSettings().radarr = [makeRadarr({ id: 4 })];

    const res = await request(app)
      .put('/settings/radarr/not-a-number')
      .send(makeRadarr({ name: 'Updated Radarr' }));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().radarr[0].name, 'Radarr');
  });

  it('rejects malformed settings IDs before delete lookup', async () => {
    getSettings().radarr = [makeRadarr({ id: 4 })];

    const res = await request(app).delete('/settings/radarr/not-a-number');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().radarr.length, 1);
  });

  it('updates settings instance zero', async () => {
    getSettings().radarr = [makeRadarr({ id: 0 })];

    const res = await request(app)
      .put('/settings/radarr/0')
      .send(makeRadarr({ name: 'Updated Radarr' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().radarr[0].name, 'Updated Radarr');
  });
});

describe('Sonarr settings routes', () => {
  it('rejects malformed Sonarr settings bodies', async () => {
    const res = await request(app).post('/settings/sonarr').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /settings must be an object/i);
  });

  it('does not clear Sonarr defaults for string boolean payloads', async () => {
    getSettings().sonarr = [makeSonarr({ id: 3, name: 'Primary Sonarr' })];

    const res = await request(app)
      .post('/settings/sonarr')
      .send(
        makeSonarr({
          name: 'String Boolean Sonarr',
          isDefault: 'true' as unknown as boolean,
          is4k: 'false' as unknown as boolean,
        })
      );

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(
      getSettings().sonarr.map(({ name, isDefault, is4k }) => ({
        name,
        isDefault,
        is4k,
      })),
      [
        { name: 'Primary Sonarr', isDefault: true, is4k: false },
        { name: 'String Boolean Sonarr', isDefault: false, is4k: false },
      ]
    );
  });

  it('rejects non-string Sonarr series type values', async () => {
    const res = await request(app)
      .post('/settings/sonarr')
      .send(
        makeSonarr({
          seriesType: ['standard'] as unknown as SonarrSettings['seriesType'],
        })
      );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /seriesType is invalid/);
    assert.strictEqual(getSettings().sonarr.length, 0);
  });

  it('rejects malformed settings IDs before update lookup', async () => {
    getSettings().sonarr = [makeSonarr({ id: 4 })];

    const res = await request(app)
      .put('/settings/sonarr/not-a-number')
      .send(makeSonarr({ name: 'Updated Sonarr' }));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().sonarr[0].name, 'Sonarr');
  });

  it('rejects malformed settings IDs before delete lookup', async () => {
    getSettings().sonarr = [makeSonarr({ id: 4 })];

    const res = await request(app).delete('/settings/sonarr/not-a-number');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().sonarr.length, 1);
  });

  it('updates settings instance zero', async () => {
    getSettings().sonarr = [makeSonarr({ id: 0 })];

    const res = await request(app)
      .put('/settings/sonarr/0')
      .send(makeSonarr({ name: 'Updated Sonarr' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().sonarr[0].name, 'Updated Sonarr');
  });
});

describe('Lidarr settings routes', () => {
  it('rejects malformed Lidarr settings bodies', async () => {
    const res = await request(app).post('/settings/lidarr').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /settings must be an object/i);
  });

  it('rejects malformed settings IDs before update lookup', async () => {
    getSettings().lidarr = [makeLidarr({ id: 4 })];

    const res = await request(app)
      .put('/settings/lidarr/not-a-number')
      .send(makeLidarr({ name: 'Updated Lidarr' }));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().lidarr[0].name, 'Lidarr');
  });

  it('rejects malformed settings IDs before profile lookup', async () => {
    getSettings().lidarr = [makeLidarr({ id: 4 })];

    const res = await request(app).get(
      '/settings/lidarr/not-a-number/profiles'
    );

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed settings IDs before delete lookup', async () => {
    getSettings().lidarr = [makeLidarr({ id: 4 })];

    const res = await request(app).delete('/settings/lidarr/not-a-number');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().lidarr.length, 1);
  });

  it('rejects malformed service detail IDs before external calls', async () => {
    const res = await request(app).get('/service/lidarr/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('updates settings instance zero', async () => {
    getSettings().lidarr = [makeLidarr({ id: 0 })];

    const res = await request(app)
      .put('/settings/lidarr/0')
      .send(makeLidarr({ name: 'Updated Lidarr' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().lidarr[0].name, 'Updated Lidarr');
  });

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

  it('promotes another Lidarr server when deleting the default', async () => {
    getSettings().lidarr = [
      makeLidarr({ id: 4, name: 'Primary Lidarr', isDefault: true }),
      makeLidarr({ id: 5, name: 'Backup Lidarr', isDefault: false }),
    ];

    const res = await request(app).delete('/settings/lidarr/4');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      getSettings().lidarr.map(({ id, name, isDefault }) => ({
        id,
        name,
        isDefault,
      })),
      [{ id: 5, name: 'Backup Lidarr', isDefault: true }]
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

  it('hides Lidarr operational details from users without service detail permissions', async () => {
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

    const res = await request(createApp(Permission.REQUEST)).get(
      '/service/lidarr'
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, [
      {
        id: 4,
        name: 'Music Backend',
        is4k: false,
        isDefault: true,
      },
    ]);
  });
});

describe('Bookshelf settings routes', () => {
  it('rejects malformed Bookshelf settings bodies', async () => {
    const res = await request(app).post('/settings/readarr').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /settings must be an object/i);
  });

  it('rejects malformed settings IDs before update lookup', async () => {
    getSettings().readarr = [makeReadarr({ id: 7 })];

    const res = await request(app)
      .put('/settings/readarr/not-a-number')
      .send(makeReadarr({ name: 'Updated Bookshelf' }));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().readarr[0].name, 'Bookshelf');
  });

  it('rejects malformed settings IDs before delete lookup', async () => {
    getSettings().readarr = [makeReadarr({ id: 7 })];

    const res = await request(app).delete('/settings/readarr/not-a-number');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().readarr.length, 1);
  });

  it('updates settings instance zero', async () => {
    getSettings().readarr = [makeReadarr({ id: 0 })];

    const res = await request(app)
      .put('/settings/readarr/0')
      .send(makeReadarr({ name: 'Updated Bookshelf' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().readarr[0].name, 'Updated Bookshelf');
  });

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

  it('promotes another Bookshelf server for the same format when deleting the default', async () => {
    getSettings().readarr = [
      makeReadarr({ id: 7, name: 'Primary Ebook', isDefault: true }),
      makeReadarr({ id: 8, name: 'Backup Ebook', isDefault: false }),
      makeReadarr({
        id: 9,
        name: 'Audio Bookshelf',
        isDefault: true,
        serviceType: 'audiobook',
      }),
    ];

    const res = await request(app).delete('/settings/readarr/7');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      getSettings().readarr.map(({ id, name, isDefault, serviceType }) => ({
        id,
        name,
        isDefault,
        serviceType,
      })),
      [
        {
          id: 8,
          name: 'Backup Ebook',
          isDefault: true,
          serviceType: 'ebook',
        },
        {
          id: 9,
          name: 'Audio Bookshelf',
          isDefault: true,
          serviceType: 'audiobook',
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
        serviceType: 'ebook',
      },
    ]);
  });

  it('diagnoses unreachable Bookshelf backends', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const res = await request(app)
      .post('/settings/readarr/diagnose')
      .send(makeReadarr());

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.category, 'backend_unreachable');
    assert.match(res.body.message, /ECONNREFUSED/);
  });

  it('diagnoses empty Bookshelf lookups', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Readarr',
      version: '0.4.20.129',
      urlBase: '',
    }));
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'http://127.0.0.1:8790',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'eBook' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => [
      { id: 1, name: 'Standard' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 1,
        path: '/books',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => []);

    const res = await request(app)
      .post('/settings/readarr/diagnose')
      .send(makeReadarr({ activeDirectory: '/books' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.category, 'lookup_empty');
    assert.strictEqual(res.body.lookupCount, 0);
  });

  it('diagnoses incomplete Bookshelf lookups', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Readarr',
      version: '0.4.20.129',
      urlBase: '',
    }));
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'http://127.0.0.1:8790',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'eBook' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => [
      { id: 1, name: 'Standard' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 1,
        path: '/books',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => [
      {
        title: 'Broken Result',
        foreignBookId: 'broken-id',
      },
    ]);

    const res = await request(app)
      .post('/settings/readarr/diagnose')
      .send(makeReadarr({ activeDirectory: '/books' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.category, 'lookup_incomplete');
    assert.strictEqual(res.body.sample[0].authorPresent, false);
  });

  it('diagnoses add rejections after lookup succeeds', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Readarr',
      version: '0.4.20.129',
      urlBase: '',
    }));
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'http://127.0.0.1:8790',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'eBook' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => [
      { id: 1, name: 'Standard' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 1,
        path: '/books',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => [
      {
        title: 'The Hobbit',
        foreignBookId: '1540236',
        author: {
          foreignAuthorId: '656983',
          authorName: 'J.R.R. Tolkien',
        },
        editions: [
          {
            foreignEditionId: '5907',
            title: 'The Hobbit',
            monitored: true,
          },
        ],
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'addBook', async () => {
      throw new Error('[Readarr] Failed to add book: rejected');
    });

    const res = await request(app)
      .post('/settings/readarr/diagnose')
      .send({ ...makeReadarr({ activeDirectory: '/books' }), testAdd: true });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.category, 'backend_add_rejected');
    assert.match(res.body.message, /rejected/);
  });

  it('hides Bookshelf operational details from users without service detail permissions', async () => {
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

    const res = await request(createApp(Permission.REQUEST)).get(
      '/service/readarr'
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, [
      {
        id: 7,
        name: 'Books Backend',
        is4k: false,
        isDefault: true,
        serviceType: 'ebook',
      },
    ]);
  });
});
