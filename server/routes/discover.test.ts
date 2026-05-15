import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import discoverRoutes from './discover';

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
  app.use('/discover', discoverRoutes);
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

describe('GET /discover/music', () => {
  it('sorts locally and exposes music discovery as a single page', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: {
        releases: [
          {
            artist_credit_name: 'Later Artist',
            artist_mbids: ['artist-later'],
            caa_id: 1,
            caa_release_mbid: 'release-later',
            listen_count: 5,
            release_date: '2026-05-10',
            release_group_mbid: 'album-later',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-later',
            release_name: 'Later Album',
            release_tags: [],
          },
          {
            artist_credit_name: 'Earlier Artist',
            artist_mbids: ['artist-earlier'],
            caa_id: 2,
            caa_release_mbid: 'release-earlier',
            listen_count: 3,
            release_date: '2026-05-01',
            release_group_mbid: 'album-earlier',
            release_group_primary_type: 'EP',
            release_group_secondary_type: '',
            release_mbid: 'release-earlier',
            release_name: 'Earlier Album',
            release_tags: [],
          },
        ],
      },
    }));

    const agent = await login();
    const res = await agent.get(
      '/discover/music?days=30&sortBy=release_date.asc&page=3'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 3);
    assert.strictEqual(res.body.totalPages, 1);
    assert.strictEqual(res.body.totalResults, 2);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Earlier Album', 'Later Album']
    );
  });

  it('falls back to a seven day window when a wider ListenBrainz query fails', async () => {
    const freshReleaseMock = mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases',
      async ({ days }: { days: number }) => {
        if (days > 7) {
          throw new Error('upstream failed');
        }

        return {
          payload: {
            releases: [
              {
                artist_credit_name: 'Fallback Artist',
                artist_mbids: ['artist-fallback'],
                caa_id: 1,
                caa_release_mbid: 'release-fallback',
                listen_count: 1,
                release_date: '2026-05-08',
                release_group_mbid: 'album-fallback',
                release_group_primary_type: 'Single',
                release_group_secondary_type: '',
                release_mbid: 'release-fallback',
                release_name: 'Fallback Album',
                release_tags: [],
              },
            ],
          },
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/music?days=90');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(freshReleaseMock.mock.callCount(), 2);
    assert.strictEqual(res.body.results[0].title, 'Fallback Album');
  });
});

describe('GET /discover/books', () => {
  it('returns mapped Open Library book discovery results', async () => {
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 1,
      start: 0,
      docs: [
        {
          key: '/works/OL1W',
          title: 'Alpha Book',
          author_name: ['Writer One'],
          author_key: ['OL1A'],
          first_publish_year: 2024,
          cover_i: 123,
          isbn: ['9780000000001'],
          edition_key: ['OL1M'],
        },
      ],
    }));

    const agent = await login();
    const res = await agent.get('/discover/books?query=alpha');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalResults, 1);
    assert.strictEqual(res.body.results[0].mediaType, 'book');
    assert.strictEqual(res.body.results[0].title, 'Alpha Book');
  });
});
