import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import PlexTvAPI from '@server/api/plextv';
import { MediaType } from '@server/constants/media';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
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
  it('returns MusicBrainz album search results when a query is provided', async () => {
    const freshReleaseMock = mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases',
      async () => {
        throw new Error('ListenBrainz should not be called for music search');
      }
    );
    const searchAlbumMock = mock.method(
      MusicBrainz.prototype,
      'searchAlbum',
      async ({
        query,
        limit,
        offset,
      }: {
        query: string;
        limit?: number;
        offset?: number;
      }) => {
        assert.strictEqual(query, 'kind of blue');
        assert.strictEqual(limit, 20);
        assert.strictEqual(offset, 20);

        return [
          {
            id: 'musicbrainz-release-group-id',
            score: 100,
            media_type: 'album',
            title: 'Kind of Blue',
            'primary-type': 'Album',
            'primary-type-id': '',
            'type-id': '',
            'first-release-date': '1959',
            'artist-credit': [
              {
                name: 'Miles Davis',
                artist: {
                  id: 'artist-id',
                  name: 'Miles Davis',
                  'sort-name': 'Davis, Miles',
                },
              },
            ],
            posterPath: undefined,
            count: 1,
            releases: [],
            releasedate: '1959',
          },
        ];
      }
    );

    const agent = await login();
    const res = await agent.get(
      '/discover/music?query=kind%20of%20blue&page=2'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(freshReleaseMock.mock.callCount(), 0);
    assert.strictEqual(searchAlbumMock.mock.callCount(), 1);
    assert.strictEqual(res.body.page, 2);
    assert.strictEqual(res.body.results[0].title, 'Kind of Blue');
  });

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

  it('only exposes the current user watchlist state on music results', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: {
        releases: [
          {
            artist_credit_name: 'Watched By Someone Else',
            artist_mbids: ['artist-other-user'],
            caa_id: 1,
            caa_release_mbid: 'release-other-user',
            listen_count: 1,
            release_date: '2026-05-08',
            release_group_mbid: 'album-other-user',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-other-user',
            release_name: 'Other User Album',
            release_tags: [],
          },
        ],
      },
    }));

    const otherUser = await getRepository(User).save(
      new User({
        email: 'other-music-watchlist@example.com',
        username: 'other-music-watchlist',
        plexUsername: 'other-music-watchlist',
        userType: UserType.LOCAL,
        avatar: '',
      })
    );
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mbId: 'album-other-user',
        mediaType: MediaType.MUSIC,
      })
    );
    await getRepository(Watchlist).save(
      new Watchlist({
        mbId: 'album-other-user',
        mediaType: MediaType.MUSIC,
        title: 'Other User Album',
        requestedBy: otherUser,
        media,
      })
    );

    const agent = await login();
    const res = await agent.get('/discover/music');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].mediaInfo.watchlists.length, 0);
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

  it('only exposes the current user watchlist state on book results', async () => {
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 1,
      start: 0,
      docs: [
        {
          key: '/works/OL2W',
          title: 'Other User Book',
          author_name: ['Writer Two'],
          author_key: ['OL2A'],
          first_publish_year: 2025,
          cover_i: 456,
          isbn: ['9780000000002'],
          edition_key: ['OL2M'],
        },
      ],
    }));

    const otherUser = await getRepository(User).save(
      new User({
        email: 'other-book-watchlist@example.com',
        username: 'other-book-watchlist',
        plexUsername: 'other-book-watchlist',
        userType: UserType.LOCAL,
        avatar: '',
      })
    );
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
        value: 'OL2W',
        canonical: true,
      })
    );
    await getRepository(Watchlist).save(
      new Watchlist({
        externalId: 'OL2W',
        mediaType: MediaType.BOOK,
        title: 'Other User Book',
        requestedBy: otherUser,
        media,
      })
    );

    const agent = await login();
    const res = await agent.get('/discover/books?query=other');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].mediaInfo.watchlists.length, 0);
  });
});

describe('GET /discover/watchlist', () => {
  it('includes local book and music watchlist items for Plex users', async () => {
    mock.method(PlexTvAPI.prototype, 'getWatchlist', async () => ({
      totalSize: 1,
      items: [
        {
          ratingKey: 'plex-movie-key',
          title: 'Plex Movie',
          type: 'movie',
          tmdbId: 123,
        },
      ],
    }));

    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.plexToken = 'plex-token';
    await userRepository.save(admin);

    const musicMedia = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mbId: 'profile-release-group',
        mediaType: MediaType.MUSIC,
      })
    );
    await getRepository(Watchlist).save([
      new Watchlist({
        mbId: 'profile-release-group',
        mediaType: MediaType.MUSIC,
        title: 'Profile Album',
        requestedBy: admin,
        media: musicMedia,
      }),
      new Watchlist({
        externalId: 'OLprofileW',
        mediaType: MediaType.BOOK,
        title: 'Profile Book',
        requestedBy: admin,
        media: await getRepository(Media).save(
          new Media({
            tmdbId: 0,
            mediaType: MediaType.BOOK,
          })
        ),
      }),
    ]);

    const agent = await login();
    const res = await agent.get('/discover/watchlist');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map(
        (item: {
          title: string;
          mediaType: string;
          mbId?: string;
          externalId?: string;
        }) => ({
          title: item.title,
          mediaType: item.mediaType,
          mbId: item.mbId,
          externalId: item.externalId,
        })
      ),
      [
        {
          title: 'Profile Album',
          mediaType: 'music',
          mbId: 'profile-release-group',
          externalId: null,
        },
        {
          title: 'Profile Book',
          mediaType: 'book',
          mbId: null,
          externalId: 'OLprofileW',
        },
        {
          title: 'Plex Movie',
          mediaType: 'movie',
          mbId: undefined,
          externalId: undefined,
        },
      ]
    );
    assert.strictEqual(res.body.totalResults, 3);
  });
});
