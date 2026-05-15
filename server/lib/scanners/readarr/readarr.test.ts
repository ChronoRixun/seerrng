import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { ReadarrBook } from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import type { ReadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

let getBooksImpl: () => Promise<ReadarrBook[]> = async () => [];
Object.defineProperty(ReadarrAPI.prototype, 'getBooks', {
  set() {},
  get() {
    return async () => getBooksImpl();
  },
  configurable: true,
});

import { readarrScanner } from '@server/lib/scanners/readarr';

setupTestDb();

function configureReadarr(overrides: Partial<ReadarrSettings>[] = [{}]): void {
  const settings = getSettings();
  settings.readarr = overrides.map((o, i) => ({
    id: i,
    name: `Readarr ${i}`,
    hostname: 'localhost',
    port: 8787,
    apiKey: 'test-key',
    baseUrl: '',
    useSsl: false,
    activeProfileId: 1,
    activeMetadataProfileId: 1,
    activeDirectory: '/books',
    isDefault: i === 0,
    syncEnabled: true,
    preventSearch: false,
    externalUrl: '',
    tags: [],
    serviceType: 'ebook',
    ...o,
  })) as ReadarrSettings[];
}

function fakeReadarrBook(overrides: Partial<ReadarrBook> = {}): ReadarrBook {
  return {
    id: 1,
    title: 'Test Book',
    foreignBookId: 'readarr-book-id',
    titleSlug: 'test-book',
    monitored: true,
    added: '2024-01-01T00:00:00Z',
    editions: [
      {
        foreignEditionId: 'edition-id',
        title: 'Test Book',
        isbn13: '9780000000001',
        monitored: true,
      },
    ],
    statistics: {
      bookFileCount: 1,
      totalBookCount: 1,
    },
    ...overrides,
  };
}

async function seedBook(identifier: string, status = MediaStatus.PROCESSING) {
  const media = await getRepository(Media).save(
    new Media({
      tmdbId: 0,
      mediaType: MediaType.BOOK,
      status,
      status4k: MediaStatus.UNKNOWN,
      identifiers: [
        new MediaIdentifier({
          provider: MediaIdentifierProvider.ISBN,
          value: identifier,
          canonical: true,
        }),
      ],
    })
  );

  return media;
}

describe('Readarr Scanner', () => {
  beforeEach(() => {
    getBooksImpl = async () => [];
  });

  it('resets PROCESSING to UNKNOWN when a book is not in any Readarr server', async () => {
    await seedBook('9780000000002');

    configureReadarr([{ syncEnabled: true }]);
    getBooksImpl = async () => [];

    await readarrScanner.run();

    const updated = await getRepository(Media).findOneOrFail({
      where: { mediaType: MediaType.BOOK },
    });
    assert.strictEqual(updated.status, MediaStatus.UNKNOWN);
  });

  it('keeps AVAILABLE books available when missing from Readarr', async () => {
    await seedBook('9780000000003', MediaStatus.AVAILABLE);

    configureReadarr([{ syncEnabled: true }]);
    getBooksImpl = async () => [];

    await readarrScanner.run();

    const updated = await getRepository(Media).findOneOrFail({
      where: { mediaType: MediaType.BOOK },
    });
    assert.strictEqual(updated.status, MediaStatus.AVAILABLE);
  });

  it('skips orphan cleanup when any Readarr server has sync disabled', async () => {
    await seedBook('9780000000004');

    configureReadarr([
      { syncEnabled: true, id: 0, hostname: 'server-a' },
      { syncEnabled: false, id: 1, hostname: 'server-b' },
    ]);
    getBooksImpl = async () => [];

    await readarrScanner.run();

    const updated = await getRepository(Media).findOneOrFail({
      where: { mediaType: MediaType.BOOK },
    });
    assert.strictEqual(updated.status, MediaStatus.PROCESSING);
  });

  it('resets PROCESSING to UNKNOWN when a book is unmonitored with no files', async () => {
    await seedBook('9780000000005');

    configureReadarr([{ syncEnabled: true }]);
    getBooksImpl = async () => [
      fakeReadarrBook({
        monitored: false,
        editions: [
          {
            foreignEditionId: 'edition-id',
            title: 'Test Book',
            isbn13: '9780000000005',
            monitored: false,
          },
        ],
        statistics: {
          bookFileCount: 0,
          totalBookCount: 1,
        },
      }),
    ];

    await readarrScanner.run();

    const updated = await getRepository(Media).findOneOrFail({
      where: { mediaType: MediaType.BOOK },
    });
    assert.strictEqual(updated.status, MediaStatus.UNKNOWN);
  });

  it('stores audiobook service data separately from ebook service data', async () => {
    const media = await seedBook('9780000000006');
    media.serviceId = 10;
    media.externalServiceId = 100;
    media.externalServiceSlug = 'ebook-slug';
    await getRepository(Media).save(media);

    configureReadarr([
      {
        id: 21,
        serviceType: 'audiobook',
        activeDirectory: '/audiobooks',
      },
    ]);
    getBooksImpl = async () => [
      fakeReadarrBook({
        id: 210,
        titleSlug: 'audiobook-slug',
        editions: [
          {
            foreignEditionId: 'edition-id',
            title: 'Test Book',
            isbn13: '9780000000006',
            monitored: true,
          },
        ],
      }),
    ];

    await readarrScanner.run();

    const updated = await getRepository(Media).findOneOrFail({
      where: { mediaType: MediaType.BOOK },
    });
    assert.strictEqual(updated.serviceId, 10);
    assert.strictEqual(updated.externalServiceId, 100);
    assert.strictEqual(updated.externalServiceSlug, 'ebook-slug');
    assert.strictEqual(updated.audiobookServiceId, 21);
    assert.strictEqual(updated.audiobookExternalServiceId, 210);
    assert.strictEqual(updated.audiobookExternalServiceSlug, 'audiobook-slug');
    assert.strictEqual(updated.status, MediaStatus.AVAILABLE);
  });

  it('keeps an available ebook available while audiobook is still processing', async () => {
    const media = await seedBook('9780000000007', MediaStatus.AVAILABLE);
    media.serviceId = 10;
    media.externalServiceId = 100;
    media.externalServiceSlug = 'ebook-slug';
    await getRepository(Media).save(media);

    configureReadarr([
      {
        id: 21,
        serviceType: 'audiobook',
        activeDirectory: '/audiobooks',
      },
    ]);
    getBooksImpl = async () => [
      fakeReadarrBook({
        id: 210,
        titleSlug: 'audiobook-slug',
        editions: [
          {
            foreignEditionId: 'edition-id',
            title: 'Test Book',
            isbn13: '9780000000007',
            monitored: true,
          },
        ],
        statistics: {
          bookFileCount: 0,
          totalBookCount: 1,
        },
      }),
    ];

    await readarrScanner.run();

    const updated = await getRepository(Media).findOneOrFail({
      where: { mediaType: MediaType.BOOK },
    });
    assert.strictEqual(updated.serviceId, 10);
    assert.strictEqual(updated.externalServiceId, 100);
    assert.strictEqual(updated.audiobookServiceId, 21);
    assert.strictEqual(updated.audiobookExternalServiceId, 210);
    assert.strictEqual(updated.status, MediaStatus.AVAILABLE);
  });
});
