import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import requestRoutes from './request';

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
  app.use('/request', requestRoutes);
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
  mock.method(MediaRequest, 'sendNotification', async () => undefined);
});

afterEach(() => {
  mock.restoreAll();
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

async function seedRequest(status = MediaRequestStatus.PENDING) {
  const userRepo = getRepository(User);
  const mediaRepo = getRepository(Media);
  const requestRepo = getRepository(MediaRequest);

  const requestedBy = await userRepo.findOneOrFail({
    where: { email: 'friend@seerr.dev' },
  });

  const media = await mediaRepo.save(
    new Media({
      mediaType: MediaType.MOVIE,
      tmdbId: 12345,
      status: MediaStatus.UNKNOWN,
      status4k: MediaStatus.UNKNOWN,
    })
  );

  const created = await requestRepo.save(
    new MediaRequest({
      type: MediaType.MOVIE,
      status,
      media,
      requestedBy,
      is4k: false,
      updatedAt: new Date('2025-03-01T00:00:00.000Z'),
    })
  );

  return requestRepo.findOneOrFail({
    where: { id: created.id },
    relations: { requestedBy: true, modifiedBy: true },
  });
}

describe('DELETE /request/:requestId', () => {
  it('allows the owner to delete their own pending request', async () => {
    const mediaRequest = await seedRequest();

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.delete(`/request/${mediaRequest.id}`);

    assert.strictEqual(res.status, 204);
  });

  it('allows an admin to delete any pending request', async () => {
    const mediaRequest = await seedRequest();

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/request/${mediaRequest.id}`);

    assert.strictEqual(res.status, 204);
  });

  it('prevents a non-owner non-admin from deleting a pending request', async () => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);

    // Create a request owned by admin, then try to delete as friend
    const owner = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });

    const media = await mediaRepo.save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 54321,
        status: MediaStatus.UNKNOWN,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const mediaRequest = await requestRepo.save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy: owner,
        is4k: false,
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.delete(`/request/${mediaRequest.id}`);

    assert.strictEqual(res.status, 401);
  });

  it('prevents the owner from deleting an approved request', async () => {
    const mediaRequest = await seedRequest(MediaRequestStatus.APPROVED);

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.delete(`/request/${mediaRequest.id}`);

    assert.strictEqual(res.status, 401);
  });

  it('returns 404 for a non-existent request', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete('/request/99999999');

    assert.strictEqual(res.status, 404);
  });
});

describe('PUT /request/:requestId (movie)', () => {
  it('persists server and root folder changes to the database', async () => {
    const requestRepo = getRepository(MediaRequest);
    const mediaRequest = await seedRequest();

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.MOVIE,
      serverId: 3,
      profileId: 7,
      rootFolder: '/updated/movies',
      tags: [1, 2],
    });

    assert.strictEqual(res.status, 200);

    const saved = await requestRepo.findOneOrFail({
      where: { id: mediaRequest.id },
    });
    assert.strictEqual(saved.serverId, 3);
    assert.strictEqual(saved.profileId, 7);
    assert.strictEqual(saved.rootFolder, '/updated/movies');
  });
});

describe('POST /request', () => {
  it('creates a pending music request with the resolved MusicBrainz release group', async (t) => {
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'release-group-id',
          release_group_metadata: {
            release_group: {
              name: 'Kind of Blue',
            },
            artist: {
              name: 'Miles Davis',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => getAlbumMock.mock.restore());

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'listenbrainz-release-id',
      serverId: 10,
      profileId: 20,
      metadataProfileId: 30,
      rootFolder: '/music',
      tags: [1, 2],
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.type, MediaType.MUSIC);
    assert.strictEqual(res.body.status, MediaRequestStatus.PENDING);
    assert.strictEqual(res.body.media.mbId, 'release-group-id');
    assert.strictEqual(res.body.serverId, 10);
    assert.strictEqual(res.body.profileId, 20);
    assert.strictEqual(res.body.metadataProfileId, 30);
    assert.strictEqual(res.body.rootFolder, '/music');
    assert.deepStrictEqual(res.body.tags, [1, 2]);

    const savedMedia = await getRepository(Media).findOneOrFail({
      where: { mbId: 'release-group-id', mediaType: MediaType.MUSIC },
      relations: { requests: true },
    });
    assert.strictEqual(savedMedia.status, MediaStatus.PENDING);
    assert.strictEqual(savedMedia.requests.length, 1);
  });

  it('creates a pending book request with normalized identifiers and format', async (t) => {
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL45804W',
          title: 'The Left Hand of Darkness',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: '/works/OL45804W',
      editionId: '/books/OL1M',
      isbn13: '978-0-441-47812-5',
      format: 'audiobook',
      serverId: 11,
      profileId: 22,
      metadataProfileId: 33,
      rootFolder: '/books',
      tags: [4, 5],
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.type, MediaType.BOOK);
    assert.strictEqual(res.body.status, MediaRequestStatus.PENDING);
    assert.strictEqual(res.body.bookFormat, 'audiobook');
    assert.strictEqual(res.body.serverId, 11);
    assert.strictEqual(res.body.profileId, 22);
    assert.strictEqual(res.body.metadataProfileId, 33);
    assert.strictEqual(res.body.rootFolder, '/books');
    assert.deepStrictEqual(res.body.tags, [4, 5]);

    const savedMedia = await getRepository(Media).findOneOrFail({
      where: { id: res.body.media.id },
      relations: { identifiers: true, requests: true },
    });
    assert.strictEqual(savedMedia.mediaType, MediaType.BOOK);
    assert.strictEqual(savedMedia.status, MediaStatus.PENDING);
    assert.strictEqual(savedMedia.requests.length, 1);
    assert.deepStrictEqual(
      savedMedia.identifiers
        .map((identifier) => ({
          provider: identifier.provider,
          value: identifier.value,
          canonical: identifier.canonical,
        }))
        .sort((a, b) => a.provider.localeCompare(b.provider)),
      [
        {
          provider: MediaIdentifierProvider.ISBN,
          value: '9780441478125',
          canonical: false,
        },
        {
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: 'OL45804W',
          canonical: true,
        },
        {
          provider: MediaIdentifierProvider.OPENLIBRARY_EDITION,
          value: 'OL1M',
          canonical: false,
        },
      ].sort((a, b) => a.provider.localeCompare(b.provider))
    );
  });

  it('blocks duplicate book requests that resolve to an existing ISBN', async (t) => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const requestedBy = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const existingMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL45804W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.BOOK,
        media: existingMedia,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );

    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL999W',
          title: 'Duplicate ISBN Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL999M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL999W',
      isbn13: '9780441478125',
    });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /request for this book already exists/i);
    assert.strictEqual(await requestRepo.count(), 1);
  });

  it('blocks duplicate book requests that resolve to an existing edition', async (t) => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const requestedBy = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const existingMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL45804W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY_EDITION,
            value: 'OL1M',
            canonical: false,
          }),
        ],
      })
    );
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.BOOK,
        media: existingMedia,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );

    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL999W',
          title: 'Duplicate Edition Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL999W',
      editionId: 'OL1M',
    });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /request for this book already exists/i);
    assert.strictEqual(await requestRepo.count(), 1);
  });

  it('blocks music requests when the release group external id is blocklisted', async (t) => {
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'blocklisted-release-group',
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => getAlbumMock.mock.restore());

    await getRepository(Blocklist).save(
      new Blocklist({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        externalId: 'blocklisted-release-group',
        externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
        title: 'Blocked Album',
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'listenbrainz-release-id',
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /album is blocklisted/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('blocks book requests when the discovered ISBN is blocklisted', async (t) => {
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL123W',
          title: 'Blocked Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
              isbn_13: ['9780000000001'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    await getRepository(Blocklist).save(
      new Blocklist({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        externalId: '9780000000001',
        externalProvider: MediaIdentifierProvider.ISBN,
        title: 'Blocked Book',
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL123W',
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /book is blocklisted/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });
});

describe('POST /request/:requestId/:status', () => {
  const cases = [
    { action: 'approve', expected: MediaRequestStatus.APPROVED },
    { action: 'decline', expected: MediaRequestStatus.DECLINED },
  ] as const;

  for (const { action, expected } of cases) {
    it(`transitions to ${action}d and records the acting user`, async () => {
      const repo = getRepository(MediaRequest);
      const pending = await seedRequest();
      const admin = await loginAs('admin@seerr.dev', 'test1234');

      const res = await admin.post(`/request/${pending.id}/${action}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, expected);
      assert.strictEqual(res.body.modifiedBy.email, 'admin@seerr.dev');

      const persisted = await repo.findOneOrFail({
        where: { id: pending.id },
        relations: { modifiedBy: true },
      });

      assert.strictEqual(persisted.status, expected);
      assert.strictEqual(persisted.modifiedBy?.email, 'admin@seerr.dev');
      assert.ok(persisted.updatedAt > pending.updatedAt);
    });
  }
});

describe('POST /request/:requestId/retry', () => {
  it('re-approves a failed request and records the acting user', async () => {
    const repo = getRepository(MediaRequest);
    const failed = await seedRequest(MediaRequestStatus.FAILED);
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const res = await admin.post(`/request/${failed.id}/retry`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, MediaRequestStatus.APPROVED);
    assert.strictEqual(res.body.modifiedBy.email, 'admin@seerr.dev');

    const persisted = await repo.findOneOrFail({
      where: { id: failed.id },
      relations: { modifiedBy: true },
    });

    assert.strictEqual(persisted.status, MediaRequestStatus.APPROVED);
    assert.strictEqual(persisted.modifiedBy?.email, 'admin@seerr.dev');
    assert.ok(persisted.updatedAt > failed.updatedAt);
  });
});
