import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import { Watchlist } from '@server/entity/Watchlist';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import watchlistRoutes from './watchlist';

let app: Express;

const getAlbumMock = mock.method(
  ListenBrainzAPI.prototype,
  'getAlbum',
  async () =>
    ({
      release_group_mbid: 'watchlist-release-group',
      release_group_metadata: {
        release_group: {
          name: 'Watchlist Album',
        },
      },
    }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
);

const getWorkMock = mock.method(
  OpenLibraryAPI.prototype,
  'getWork',
  async () => ({
    key: '/works/OL45804W',
    title: 'The Left Hand of Darkness',
    description: 'A testable book.',
    covers: [1],
    authors: [{ author: { key: '/authors/OL1A' } }],
  })
);

const mediaRequestMock = mock.method(
  MediaRequest,
  'request',
  async () => new MediaRequest()
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
  app.use('/watchlist', watchlistRoutes);
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
  getAlbumMock.mock.resetCalls();
  getWorkMock.mock.resetCalls();
  mediaRequestMock.mock.resetCalls();
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

describe('POST /watchlist', () => {
  it('auto-requests music watchlist items when music watchlist sync is enabled', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.settings = new UserSettings({
      watchlistSyncMusic: true,
    });
    await userRepository.save(admin);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/watchlist').send({
      mediaType: MediaType.MUSIC,
      mbId: 'watchlist-release-group',
      title: 'Watchlist Album',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(getAlbumMock.mock.callCount(), 1);
    assert.strictEqual(mediaRequestMock.mock.callCount(), 1);
    assert.deepStrictEqual(mediaRequestMock.mock.calls[0].arguments[0], {
      mediaId: 'watchlist-release-group',
      mediaType: MediaType.MUSIC,
    });
    assert.strictEqual(
      mediaRequestMock.mock.calls[0].arguments[2]?.isAutoRequest,
      true
    );
  });

  it('does not auto-request music watchlist items when music watchlist sync is disabled', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/watchlist').send({
      mediaType: MediaType.MUSIC,
      mbId: 'watchlist-release-group-disabled',
      title: 'Watchlist Album',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(mediaRequestMock.mock.callCount(), 0);
  });

  it('auto-requests book watchlist items when book watchlist sync is enabled', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.settings = new UserSettings({
      watchlistSyncBooks: true,
    });
    await userRepository.save(admin);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/watchlist').send({
      mediaType: MediaType.BOOK,
      externalId: 'OL45804W',
      title: 'The Left Hand of Darkness',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(getWorkMock.mock.callCount(), 1);
    assert.strictEqual(mediaRequestMock.mock.callCount(), 1);
    assert.deepStrictEqual(mediaRequestMock.mock.calls[0].arguments[0], {
      mediaId: 'OL45804W',
      mediaType: MediaType.BOOK,
      format: 'ebook',
    });
    assert.strictEqual(
      mediaRequestMock.mock.calls[0].arguments[2]?.isAutoRequest,
      true
    );
  });

  it('blocks duplicate book watchlist items by Open Library ID for the same user', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const body = {
      mediaType: MediaType.BOOK,
      externalId: 'OLduplicateW',
      title: 'Duplicate Book',
    };

    const firstRes = await agent.post('/watchlist').send(body);
    const duplicateRes = await agent.post('/watchlist').send(body);

    assert.strictEqual(firstRes.status, 201);
    assert.strictEqual(duplicateRes.status, 409);
  });
});

describe('DELETE /watchlist/:mediaId', () => {
  it('deletes music watchlist items by MusicBrainz ID', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    const watchlistRepository = getRepository(Watchlist);
    await watchlistRepository.save(
      new Watchlist({
        mediaType: MediaType.MUSIC,
        mbId: 'delete-release-group-id',
        title: 'Delete Album',
        requestedBy: admin,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(
      '/watchlist/delete-release-group-id?mediaType=music'
    );

    assert.strictEqual(res.status, 204);
    assert.strictEqual(
      await watchlistRepository.exist({
        where: {
          mediaType: MediaType.MUSIC,
          mbId: 'delete-release-group-id',
          requestedBy: { id: admin.id },
        },
      }),
      false
    );
  });

  it('deletes book watchlist items by Open Library ID', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    const watchlistRepository = getRepository(Watchlist);
    await watchlistRepository.save(
      new Watchlist({
        mediaType: MediaType.BOOK,
        externalId: 'OLdeleteW',
        title: 'Delete Book',
        requestedBy: admin,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete('/watchlist/OLdeleteW?mediaType=book');

    assert.strictEqual(res.status, 204);
    assert.strictEqual(
      await watchlistRepository.exist({
        where: {
          mediaType: MediaType.BOOK,
          externalId: 'OLdeleteW',
          requestedBy: { id: admin.id },
        },
      }),
      false
    );
  });
});
