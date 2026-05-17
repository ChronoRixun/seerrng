import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import ReadarrAPI from '@server/api/servarr/readarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import mediaRoutes from './media';

let app: Express;

const removeBookMock = mock.method(
  ReadarrAPI.prototype,
  'removeBook',
  async () => undefined
);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/media', mediaRoutes);
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

before(async () => {
  app = createApp();
});

beforeEach(() => {
  removeBookMock.mock.resetCalls();
  removeBookMock.mock.mockImplementation(async () => undefined);
  const settings = getSettings();
  settings.readarr = [
    {
      id: 10,
      name: 'Bookshelf',
      hostname: 'bookshelf.local',
      port: 8787,
      apiKey: 'ebook-key',
      useSsl: false,
      baseUrl: '',
      activeProfileId: 1,
      activeProfileName: 'Ebooks',
      activeDirectory: '/books',
      activeMetadataProfileId: 1,
      tags: [],
      is4k: false,
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
      overrideRule: [],
      serviceType: 'ebook',
    },
    {
      id: 20,
      name: 'Audio Bookshelf',
      hostname: 'audiobooks.local',
      port: 8787,
      apiKey: 'audio-key',
      useSsl: false,
      baseUrl: '',
      activeProfileId: 2,
      activeProfileName: 'Audio',
      activeDirectory: '/audiobooks',
      activeMetadataProfileId: 2,
      tags: [],
      is4k: false,
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
      overrideRule: [],
      serviceType: 'audiobook',
    },
  ];
});

setupTestDb();

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('GET /media', () => {
  it('rejects malformed list filter values', async () => {
    const res = await request(app).get(
      '/media?filter=pending&filter=available'
    );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Filter must be a string/);
  });

  it('rejects unknown list sort values', async () => {
    const res = await request(app).get('/media?sort=drop-table');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sort must be valid/);
  });

  it('filters media lists by media type before pagination', async () => {
    await getRepository(Media).save([
      new Media({
        tmdbId: 0,
        mediaType: MediaType.MUSIC,
        status: MediaStatus.AVAILABLE,
        mediaAddedAt: new Date('2026-01-03T00:00:00.000Z'),
      }),
      new Media({
        tmdbId: 123,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        mediaAddedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
      new Media({
        tmdbId: 456,
        mediaType: MediaType.TV,
        status: MediaStatus.PARTIALLY_AVAILABLE,
        mediaAddedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        mediaAddedAt: new Date('2025-12-31T00:00:00.000Z'),
      }),
    ]);

    const res = await request(app).get(
      '/media?filter=allavailable&sort=mediaAdded&take=20&mediaType=movie,tv'
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((item: { mediaType: string }) => item.mediaType),
      [MediaType.MOVIE, MediaType.TV]
    );
  });

  it('rejects malformed media type filters', async () => {
    const res = await request(app).get('/media?mediaType=movie,invalid');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Media type must be valid/);
  });
});

describe('POST /media/:id/:status', () => {
  it('rejects malformed media IDs before lookup', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/media/not-a-number/available').send();

    assert.strictEqual(res.status, 404);
  });

  it('rejects unknown media status transitions', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 1,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post(`/media/${media.id}/not-a-status`).send();

    assert.strictEqual(res.status, 404);

    const persisted = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(persisted.status, MediaStatus.PENDING);
  });

  it('rejects malformed season status update bodies', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 2,
        mediaType: MediaType.TV,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post(`/media/${media.id}/available`).send({
      seasons: [{ seasonNumber: 'not-a-number' }],
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /seasonNumber must be an integer/i);
  });

  it('rejects malformed media status update bodies', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 4,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post(`/media/${media.id}/available`).send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Media status body must be an object/);

    const persisted = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(persisted.status, MediaStatus.PENDING);
  });

  it('rejects string is4k status update bodies', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 3,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent
      .post(`/media/${media.id}/available`)
      .send({ is4k: 'true' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /is4k must be a boolean/i);
  });
});

describe('DELETE /media/:id/file', () => {
  it('rejects malformed is4k file deletion query values', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        serviceId: 10,
        externalServiceId: 100,
        externalServiceSlug: 'ebook-slug',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file?is4k=yes`);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /is4k must be valid/i);
    assert.strictEqual(removeBookMock.mock.callCount(), 0);
  });

  it('rejects unknown book format query values before deletion', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        serviceId: 10,
        externalServiceId: 100,
        externalServiceSlug: 'ebook-slug',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file?format=pdf`);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Format must be valid/);
    assert.strictEqual(removeBookMock.mock.callCount(), 0);
  });

  it('removes only the ebook link when an audiobook link remains', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        serviceId: 10,
        externalServiceId: 100,
        externalServiceSlug: 'ebook-slug',
        audiobookServiceId: 20,
        audiobookExternalServiceId: 200,
        audiobookExternalServiceSlug: 'audiobook-slug',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file?format=ebook`);

    assert.strictEqual(res.status, 204);
    assert.strictEqual(removeBookMock.mock.callCount(), 1);
    assert.strictEqual(removeBookMock.mock.calls[0].arguments[0], 100);

    const updated = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(updated.serviceId, null);
    assert.strictEqual(updated.externalServiceId, null);
    assert.strictEqual(updated.externalServiceSlug, null);
    assert.strictEqual(updated.audiobookServiceId, 20);
    assert.strictEqual(updated.audiobookExternalServiceId, 200);
    assert.strictEqual(updated.audiobookExternalServiceSlug, 'audiobook-slug');
    assert.strictEqual(updated.status, MediaStatus.PARTIALLY_AVAILABLE);
  });

  it('persists successful book format removals when another format fails', async () => {
    removeBookMock.mock.mockImplementation(async (bookId: number) => {
      if (bookId === 200) {
        throw new Error('Audiobook removal failed');
      }
    });

    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        serviceId: 10,
        externalServiceId: 100,
        externalServiceSlug: 'ebook-slug',
        audiobookServiceId: 20,
        audiobookExternalServiceId: 200,
        audiobookExternalServiceSlug: 'audiobook-slug',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file?format=both`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(removeBookMock.mock.callCount(), 2);
    assert.strictEqual(removeBookMock.mock.calls[0].arguments[0], 100);
    assert.strictEqual(removeBookMock.mock.calls[1].arguments[0], 200);

    const updated = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(updated.serviceId, null);
    assert.strictEqual(updated.externalServiceId, null);
    assert.strictEqual(updated.externalServiceSlug, null);
    assert.strictEqual(updated.audiobookServiceId, 20);
    assert.strictEqual(updated.audiobookExternalServiceId, 200);
    assert.strictEqual(updated.audiobookExternalServiceSlug, 'audiobook-slug');
    assert.strictEqual(updated.status, MediaStatus.PARTIALLY_AVAILABLE);
  });
});
