import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
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
    } as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>)
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
});
