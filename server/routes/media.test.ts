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

describe('DELETE /media/:id/file', () => {
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
});
