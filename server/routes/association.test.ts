import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import { getRepository } from '@server/datasource';
import MetadataArtist from '@server/entity/MetadataArtist';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import associationRoutes from './association';
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
  app.use('/association', associationRoutes);
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

const mockPrivateMethod = mock.method as (
  object: object,
  methodName: string,
  implementation: (...args: unknown[]) => unknown
) => unknown;
const mockPrivate = (
  object: object,
  methodName: string,
  implementation: (...args: unknown[]) => unknown
) => mockPrivateMethod.call(mock, object, methodName, implementation);

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

const movieResult = (id: number, title: string, vote: number) => ({
  id,
  media_type: 'movie',
  title,
  original_title: title,
  release_date: '2024-01-01',
  adult: false,
  video: false,
  popularity: 10,
  poster_path: `/${id}.jpg`,
  backdrop_path: `/${id}-bd.jpg`,
  vote_count: 100,
  vote_average: vote,
  genre_ids: [18],
  overview: '',
  original_language: 'en',
});

const movieDetail = {
  id: 123,
  title: 'Root Movie',
  genres: [{ id: 18, name: 'Drama' }],
  credits: {
    cast: [{ id: 9001, name: 'Lead Actor', order: 0, profile_path: '/a.jpg' }],
    crew: [
      {
        id: 7777,
        name: 'Famous Composer',
        job: 'Original Music Composer',
        department: 'Sound',
        profile_path: '/c.jpg',
      },
    ],
  },
};

function mockTmdb() {
  mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
    if (endpoint === '/movie/123') {
      return movieDetail;
    }
    if (endpoint === '/movie/123/similar') {
      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [movieResult(200, 'Similar Movie', 8)],
      };
    }
    if (endpoint === '/movie/123/recommendations') {
      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [movieResult(300, 'Recommended Movie', 6)],
      };
    }
    throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
  });
}

describe('GET /association/:mediaType/:id', () => {
  it('rejects an unknown media type', async () => {
    const agent = await login();
    const res = await agent.get('/association/podcast/abc');
    assert.strictEqual(res.status, 400);
  });

  it('returns same-medium similar and recommended edges for a movie', async () => {
    mockTmdb();
    const agent = await login();
    const res = await agent.get('/association/movie/123');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.root.title, 'Root Movie');

    const byType = res.body.edges.reduce(
      (acc: Record<string, number>, e: { type: string }) => {
        acc[e.type] = (acc[e.type] ?? 0) + 1;
        return acc;
      },
      {}
    );
    assert.ok(byType.similar >= 1, 'expected at least one similar edge');
    assert.ok(
      byType.recommended >= 1,
      'expected at least one recommended edge'
    );
    // Higher-voted similar title should outrank the recommended one.
    assert.strictEqual(res.body.edges[0].node.id, 200);
  });

  it('emits a cross-medium shared-person edge for a mapped composer', async () => {
    await getRepository(MetadataArtist).save(
      new MetadataArtist({
        mbArtistId: 'mb-composer-1',
        tmdbPersonId: '7777',
        tmdbThumb: 'https://img/composer.jpg',
        tmdbUpdatedAt: new Date(),
      })
    );

    mockTmdb();
    const agent = await login();
    const res = await agent.get('/association/movie/123');

    assert.strictEqual(res.status, 200);
    const crossEdge = res.body.edges.find(
      (e: { type: string; node: { id: string } }) =>
        e.type === 'shared-person' && e.node.id === 'mb-composer-1'
    );
    assert.ok(crossEdge, 'expected a shared-person edge to the composer');
    assert.strictEqual(crossEdge.node.mediaType, 'artist');
    assert.match(crossEdge.reason, /scored this/);
  });
});
