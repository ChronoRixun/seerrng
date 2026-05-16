import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import musicRoutes from './music';

let app: Express;

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
  app.use('/music', musicRoutes);
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

async function login() {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

const albumDetails = {
  release_group_metadata: {
    artist: {
      artists: [
        {
          artist_mbid: 'artist-id',
          type: 'Group',
        },
      ],
    },
  },
};

describe('GET /music/:id artist lists', () => {
  it('normalizes empty artist discography pagination', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getAlbum', async () => albumDetails);
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () => ({
      releaseGroups: [],
    }));

    const agent = await login();
    const res = await agent.get('/music/release-group-id/artist-discography');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalPages, 1);
    assert.strictEqual(res.body.totalResults, 0);
    assert.deepStrictEqual(res.body.results, []);
  });

  it('normalizes empty similar artist pagination', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getAlbum', async () => albumDetails);
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () => ({
      similarArtists: {
        artists: [],
      },
    }));

    const agent = await login();
    const res = await agent.get('/music/release-group-id/artist-similar');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalPages, 1);
    assert.strictEqual(res.body.totalResults, 0);
    assert.deepStrictEqual(res.body.results, []);
  });
});
