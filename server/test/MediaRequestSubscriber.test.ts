import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import OpenLibraryAPI from '@server/api/openlibrary';
import type { LidarrAlbumOptions } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import type {
  ReadarrBookLookupResult,
  ReadarrBookOptions,
} from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import notificationManager from '@server/lib/notifications';
import { getSettings } from '@server/lib/settings';
import { MediaRequestSubscriber } from '@server/subscriber/MediaRequestSubscriber';
import { resetTestDb, seedTestDb } from '@server/utils/seedTestDb';

async function getRequester() {
  return getRepository(User).findOneOrFail({
    where: { email: 'friend@seerr.dev' },
  });
}

async function createApprovedRequest(media: Media, requestedBy: User) {
  mock.method(MediaRequest, 'sendNotification', async () => undefined);

  const request = await getRepository(MediaRequest).save(
    new MediaRequest({
      type: media.mediaType,
      status: MediaRequestStatus.PENDING,
      media,
      requestedBy,
      is4k: false,
    })
  );

  request.status = MediaRequestStatus.APPROVED;
  request.media = media;
  request.requestedBy = requestedBy;

  return request;
}

describe('MediaRequestSubscriber service dispatch', () => {
  before(async () => {
    await seedTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    mock.restoreAll();
    const settings = getSettings();
    settings.lidarr = [];
    settings.readarr = [];
  });

  it('sends approved music requests to Lidarr and completes the request', async () => {
    const settings = getSettings();
    settings.lidarr = [
      {
        id: 10,
        name: 'Lidarr',
        hostname: 'lidarr.local',
        port: 8686,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 7,
        activeProfileName: 'Lossless',
        activeMetadataProfileId: 8,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/music',
        tags: [3],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'release-group-id',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const request = await createApprovedRequest(media, requestedBy);

    const searchMock = mock.method(
      LidarrAPI.prototype,
      'searchAlbumByMusicBrainzId',
      async () =>
        [
          {
            id: 1,
            mbId: 'release-group-id',
            media_type: 'music',
            album: {
              title: 'Kind of Blue',
              disambiguation: '',
              overview: 'Album overview',
              artistId: 2,
              foreignAlbumId: 'release-group-id',
              duration: 2700,
              albumType: 'Album',
              mediumCount: 1,
              ratings: { votes: 1, value: 10 },
              releaseDate: '1959-08-17',
              genres: ['Jazz'],
              images: [],
              links: [],
              artist: {
                id: 2,
                status: 'continuing',
                ended: false,
                artistName: 'Miles Davis',
                foreignArtistId: 'artist-id',
                tadbId: 0,
                discogsId: 0,
                overview: 'Artist overview',
                artistType: 'Person',
                disambiguation: '',
                links: [],
                images: [],
                genres: ['Jazz'],
                cleanName: 'milesdavis',
                sortName: 'davis miles',
                tags: [],
                added: '2026-01-01T00:00:00Z',
                ratings: { votes: 1, value: 10 },
              },
            },
          },
        ] as unknown as Awaited<
          ReturnType<LidarrAPI['searchAlbumByMusicBrainzId']>
        >
    );
    let addPayload: LidarrAlbumOptions | undefined;
    mock.method(
      LidarrAPI.prototype,
      'addAlbum',
      async (payload: LidarrAlbumOptions) => {
        addPayload = payload;

        return {
          id: 44,
          titleSlug: 'kind-of-blue',
        } as Awaited<ReturnType<LidarrAPI['addAlbum']>>;
      }
    );

    await new MediaRequestSubscriber().sendToLidarr(request);

    assert.strictEqual(
      searchMock.mock.calls[0].arguments[0],
      'release-group-id'
    );
    assert.equal(addPayload?.profileId, 7);
    assert.equal(addPayload?.artist.metadataProfileId, 8);
    assert.equal(addPayload?.artist.rootFolderPath, '/music');
    assert.deepStrictEqual(addPayload?.artist.tags, [3]);

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.externalServiceId, 44);
    assert.equal(savedMedia.externalServiceSlug, 'kind-of-blue');
    assert.equal(savedMedia.serviceId, 10);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('resolves approved book requests through ISBN before title and stores Readarr identifiers', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
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
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => ({
      key: '/works/OL45804W',
      title: 'The Left Hand of Darkness',
    }));

    const lookupTerms: string[] = [];
    mock.method(ReadarrAPI.prototype, 'lookupBook', async (term: string) => {
      lookupTerms.push(term);

      if (term === '9780441478125') {
        return [];
      }

      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: true,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });
    let addPayload: ReadarrBookOptions | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayload = payload;

        return {
          ...payload,
          id: 55,
          titleSlug: 'left-hand-darkness',
        };
      }
    );
    mock.method(notificationManager, 'sendNotification', () => undefined);

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.deepStrictEqual(lookupTerms, [
      '9780441478125',
      'isbn:9780441478125',
    ]);
    assert.equal(addPayload?.qualityProfileId, 11);
    assert.equal(addPayload?.foreignBookId, 'readarr-work-id');
    assert.equal(addPayload?.metadataProfileId, 12);
    assert.equal(addPayload?.rootFolderPath, '/books');
    assert.deepStrictEqual(addPayload?.tags, [4]);

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.externalServiceId, 55);
    assert.equal(savedMedia.externalServiceSlug, 'left-hand-darkness');
    assert.equal(savedMedia.serviceId, 20);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('sends audiobook requests to the default audiobook Bookshelf server', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/ebooks',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'audiobook';

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => ({
      key: '/works/OL45804W',
      title: 'The Left Hand of Darkness',
    }));
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-audio-id',
          titleSlug: 'the-left-hand-of-darkness-audio',
          editions: [
            {
              foreignEditionId: 'audio-edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    let addPayload: ReadarrBookOptions | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayload = payload;
        return {
          ...payload,
          id: 41,
          titleSlug: 'the-left-hand-of-darkness-audio',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.equal(addPayload?.rootFolderPath, '/audiobooks');
    assert.equal(addPayload?.qualityProfileId, 31);
    assert.equal(addPayload?.metadataProfileId, 32);
    assert.deepEqual(addPayload?.tags, [9]);

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.audiobookServiceId, 21);
    assert.equal(savedMedia.audiobookExternalServiceId, 41);
    assert.equal(
      savedMedia.audiobookExternalServiceSlug,
      'the-left-hand-of-darkness-audio'
    );
  });

  it('does not treat ebook availability as audiobook availability', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 20,
        externalServiceId: 40,
        externalServiceSlug: 'ebook-slug',
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'audiobook';

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-audio-id',
          titleSlug: 'left-hand-darkness-audio',
          editions: [
            {
              foreignEditionId: 'audio-edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    let addPayload: ReadarrBookOptions | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayload = payload;
        return {
          ...payload,
          id: 41,
          titleSlug: 'left-hand-darkness-audio',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.equal(addPayload?.rootFolderPath, '/audiobooks');

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.serviceId, 20);
    assert.equal(savedMedia.externalServiceId, 40);
    assert.equal(savedMedia.audiobookServiceId, 21);
    assert.equal(savedMedia.audiobookExternalServiceId, 41);
  });

  it('sends both-format book requests to ebook and audiobook Bookshelf servers', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/ebooks',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'both';

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    const addPayloads: ReadarrBookOptions[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayloads.push(payload);
        const isAudio = payload.rootFolderPath === '/audiobooks';

        return {
          ...payload,
          id: isAudio ? 41 : 40,
          titleSlug: isAudio
            ? 'left-hand-darkness-audio'
            : 'left-hand-darkness-ebook',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.deepEqual(
      addPayloads.map((payload) => ({
        rootFolderPath: payload.rootFolderPath,
        qualityProfileId: payload.qualityProfileId,
        metadataProfileId: payload.metadataProfileId,
        tags: payload.tags,
      })),
      [
        {
          rootFolderPath: '/ebooks',
          qualityProfileId: 11,
          metadataProfileId: 12,
          tags: [4],
        },
        {
          rootFolderPath: '/audiobooks',
          qualityProfileId: 31,
          metadataProfileId: 32,
          tags: [9],
        },
      ]
    );

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.serviceId, 20);
    assert.equal(savedMedia.externalServiceId, 40);
    assert.equal(savedMedia.externalServiceSlug, 'left-hand-darkness-ebook');
    assert.equal(savedMedia.audiobookServiceId, 21);
    assert.equal(savedMedia.audiobookExternalServiceId, 41);
    assert.equal(
      savedMedia.audiobookExternalServiceSlug,
      'left-hand-darkness-audio'
    );
  });

  it('keeps the ebook service link when the audiobook half of a both request fails', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/ebooks',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'both';

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    let addCount = 0;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addCount += 1;

        if (addCount === 2) {
          throw new Error('Audiobook backend unavailable');
        }

        return {
          ...payload,
          id: 40,
          titleSlug: 'left-hand-darkness-ebook',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.serviceId, 20);
    assert.equal(savedMedia.externalServiceId, 40);
    assert.equal(savedMedia.externalServiceSlug, 'left-hand-darkness-ebook');
    assert.equal(savedMedia.audiobookServiceId, null);
    assert.equal(savedMedia.audiobookExternalServiceId, null);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.FAILED);
  });

  it('skips an existing ebook link when retrying a partial both-format book request', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/ebooks',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 20,
        externalServiceId: 40,
        externalServiceSlug: 'left-hand-darkness-ebook',
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'both';

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    const addPayloads: ReadarrBookOptions[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayloads.push(payload);
        return {
          ...payload,
          id: 41,
          titleSlug: 'left-hand-darkness-audio',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.deepEqual(
      addPayloads.map((payload) => payload.rootFolderPath),
      ['/audiobooks']
    );

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.serviceId, 20);
    assert.equal(savedMedia.externalServiceId, 40);
    assert.equal(savedMedia.externalServiceSlug, 'left-hand-darkness-ebook');
    assert.equal(savedMedia.audiobookServiceId, 21);
    assert.equal(savedMedia.audiobookExternalServiceId, 41);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('resets stale music processing status when the last request is declined', async () => {
    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'declined-release-group-id',
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        status: MediaRequestStatus.DECLINED,
        media,
        requestedBy,
        is4k: false,
      })
    );

    await new MediaRequestSubscriber().updateParentStatus(request);

    const updatedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(updatedMedia.status, MediaStatus.UNKNOWN);
  });

  it('preserves book availability after declining the last missing-format request', async () => {
    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 20,
        externalServiceId: 40,
        externalServiceSlug: 'ebook-slug',
      })
    );
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        status: MediaRequestStatus.DECLINED,
        media,
        requestedBy,
        is4k: false,
        bookFormat: 'audiobook',
      })
    );

    await new MediaRequestSubscriber().updateParentStatus(request);

    const updatedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(updatedMedia.status, MediaStatus.AVAILABLE);
    assert.equal(updatedMedia.serviceId, 20);
    assert.equal(updatedMedia.externalServiceId, 40);
    assert.equal(updatedMedia.audiobookServiceId, null);
  });
});
