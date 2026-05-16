import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import artistRoutes from './artist';
import authRoutes from './auth';

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
  app.use('/artist', artistRoutes);
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
  cacheManager.getCache('associations').flush();
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

const artistDetails = (similarCount: number) => ({
  artist: {
    area: 'US',
    artist_mbid: 'root-artist',
    begin_year: 2000,
    mbid: 'root-artist',
    name: 'Root Artist',
    rels: {},
    tag: { artist: [] },
    type: 'Group',
  },
  coverArt: '',
  listeningStats: { total_listen_count: 0, total_user_count: 0 },
  popularRecordings: [],
  releaseGroups: [],
  similarArtists: {
    artists: Array.from({ length: similarCount }, (_, index) => ({
      artist_mbid: `similar-${index + 1}`,
      name: `Similar Artist ${index + 1}`,
      score: 100 - index,
      type: 'Group',
    })),
    topRecordingColor: { red: 0, green: 0, blue: 0 },
    topReleaseGroupColor: { red: 0, green: 0, blue: 0 },
  },
});

describe('GET /artist/:id/similar', () => {
  it('returns paginated similar artists from the association graph', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () =>
      artistDetails(3)
    );
    mock.method(TheAudioDb.prototype, 'batchGetArtistImages', async () => ({}));
    mock.method(TmdbPersonMapper.prototype, 'batchGetMappings', async () => []);

    const agent = await login();
    const res = await agent.get('/artist/root-artist/similar?page=2&pageSize=1');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 2);
    assert.strictEqual(res.body.pageSize, 1);
    assert.strictEqual(res.body.totalPages, 3);
    assert.strictEqual(res.body.totalResults, 3);
    assert.deepStrictEqual(
      res.body.results.map((artist: { id: string; name: string }) => [
        artist.id,
        artist.name,
      ]),
      [['similar-2', 'Similar Artist 2']]
    );
  });

  it('normalizes invalid pagination input and caps page size', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () =>
      artistDetails(60)
    );
    mock.method(TheAudioDb.prototype, 'batchGetArtistImages', async () => ({}));
    mock.method(TmdbPersonMapper.prototype, 'batchGetMappings', async () => []);

    const agent = await login();
    const res = await agent.get(
      '/artist/root-artist/similar?page=-10&pageSize=999'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 1);
    assert.strictEqual(res.body.pageSize, 50);
    assert.strictEqual(res.body.totalPages, 2);
    assert.strictEqual(res.body.totalResults, 60);
    assert.strictEqual(res.body.results.length, 50);
  });
});
