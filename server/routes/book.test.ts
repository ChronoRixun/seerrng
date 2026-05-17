import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import OpenLibraryAPI from '@server/api/openlibrary';
import {
  MediaRequestStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import bookRoutes from './book';

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
  app.use('/book', bookRoutes);
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

function mockBookDetails() {
  mock.method(OpenLibraryAPI.prototype, 'getWork', async () => ({
    key: '/works/OL45804W',
    title: 'The Test Book',
    authors: [{ author: { key: '/authors/OL1A' } }],
    covers: [123],
    first_publish_date: '1999',
    description: 'A testable book.',
    subjects: ['Testing'],
  }));

  mock.method(OpenLibraryAPI.prototype, 'getWorkEditions', async () => ({
    size: 1,
    entries: [
      {
        key: '/books/OL1M',
        title: 'The Test Book',
        isbn_13: ['9780000000002'],
        physical_format: 'Paperback',
      },
    ],
  }));

  mock.method(OpenLibraryAPI.prototype, 'getAuthor', async () => ({
    key: '/authors/OL1A',
    name: 'Test Author',
  }));
}

describe('GET /book/:id', () => {
  it('rejects malformed book IDs before calling OpenLibrary', async () => {
    const getWork = mock.method(OpenLibraryAPI.prototype, 'getWork');
    const getWorkEditions = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions'
    );

    const agent = await login();
    const res = await agent.get(`/book/${'x'.repeat(129)}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getWork.mock.callCount(), 0);
    assert.strictEqual(getWorkEditions.mock.callCount(), 0);
  });

  it('reports whether the current user has the book on their watchlist', async () => {
    mockBookDetails();

    const agent = await login();
    const user = await getRepository(User).findOneByOrFail({
      email: 'admin@seerr.dev',
    });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
      })
    );
    await getRepository(MediaIdentifier).save(
      new MediaIdentifier({
        media,
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'OL45804W',
        canonical: true,
      })
    );
    await getRepository(Watchlist).save(
      new Watchlist({
        externalId: 'OL45804W',
        mediaType: MediaType.BOOK,
        title: 'The Test Book',
        requestedBy: user,
        media,
      })
    );

    const res = await agent.get('/book/OL45804W');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, 'OL45804W');
    assert.strictEqual(res.body.author, 'Test Author');
    assert.strictEqual(res.body.onUserWatchlist, true);
  });

  it('filters saved media request users from book detail responses', async () => {
    mockBookDetails();

    const agent = await login();
    const user = await getRepository(User).findOneByOrFail({
      email: 'admin@seerr.dev',
    });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
      })
    );
    await getRepository(MediaIdentifier).save(
      new MediaIdentifier({
        media,
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'OL45804W',
        canonical: true,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy: user,
        modifiedBy: user,
        is4k: false,
        bookFormat: 'ebook',
      })
    );

    const res = await agent.get('/book/OL45804W');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.mediaInfo.requests[0].requestedBy.id, user.id);
    assert.strictEqual(
      res.body.mediaInfo.requests[0].requestedBy.email,
      undefined
    );
    assert.strictEqual(
      res.body.mediaInfo.requests[0].modifiedBy.email,
      undefined
    );
  });

  it('still returns book details when author lookup fails', async () => {
    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => ({
      key: '/works/OL45804W',
      title: 'The Test Book',
      authors: [{ author: { key: '/authors/OL1A' } }],
    }));
    mock.method(OpenLibraryAPI.prototype, 'getWorkEditions', async () => ({
      size: 0,
      entries: [],
    }));
    mock.method(OpenLibraryAPI.prototype, 'getAuthor', async () => {
      throw new Error('Open Library author unavailable');
    });

    const agent = await login();
    const res = await agent.get('/book/OL45804W');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, 'OL45804W');
    assert.strictEqual(res.body.authorId, 'OL1A');
    assert.strictEqual(res.body.author, undefined);
  });
});

describe('GET /book/search', () => {
  it('rejects missing search queries before provider lookup', async () => {
    const searchBooks = mock.method(OpenLibraryAPI.prototype, 'searchBooks');

    const agent = await login();
    const res = await agent.get('/book/search');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(searchBooks.mock.callCount(), 0);
  });

  it('rejects oversized search queries before provider lookup', async () => {
    const searchBooks = mock.method(OpenLibraryAPI.prototype, 'searchBooks');

    const agent = await login();
    const res = await agent
      .get('/book/search')
      .query({ query: 'x'.repeat(257) });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(searchBooks.mock.callCount(), 0);
  });

  it('normalizes empty search pagination', async () => {
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 0,
      start: 0,
      docs: [],
    }));

    const agent = await login();
    const res = await agent.get('/book/search?query=notfound');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalPages, 1);
    assert.strictEqual(res.body.totalResults, 0);
    assert.deepStrictEqual(res.body.results, []);
  });
});
