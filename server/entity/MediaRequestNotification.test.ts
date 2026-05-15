import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
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
import type { NotificationPayload } from '@server/lib/notifications/agents/agent';
import notificationManager, { Notification } from '@server/lib/notifications';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

setupTestDb();

async function getFriendUser() {
  return getRepository(User).findOneOrFail({
    where: { email: 'friend@seerr.dev' },
  });
}

describe('MediaRequest.sendNotification', () => {
  it('sends music notifications with album metadata', async (t) => {
    const sendNotificationMock = mock.method(
      notificationManager,
      'sendNotification',
      () => undefined
    );
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'release-group-id',
          release_group_metadata: {
            release_group: {
              name: 'Kind of Blue',
              date: '1959-08-17',
            },
            artist: {
              name: 'Miles Davis',
            },
          },
        } as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>)
    );
    t.after(() => {
      sendNotificationMock.mock.restore();
      getAlbumMock.mock.restore();
    });

    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'release-group-id',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const entity = new MediaRequest({
      type: MediaType.MUSIC,
      media,
      requestedBy: await getFriendUser(),
      status: MediaRequestStatus.APPROVED,
      is4k: false,
    });

    await MediaRequest.sendNotification(
      entity,
      media,
      Notification.MEDIA_APPROVED
    );

    assert.strictEqual(sendNotificationMock.mock.callCount(), 1);
    const [type, payload] = sendNotificationMock.mock.calls[0]
      .arguments as [Notification, NotificationPayload];
    assert.strictEqual(type, Notification.MEDIA_APPROVED);
    assert.strictEqual(payload.event, 'Music Request Approved');
    assert.strictEqual(payload.subject, 'Kind of Blue (1959)');
    assert.strictEqual(payload.message, 'Miles Davis');
    assert.deepStrictEqual(payload.extra, [
      {
        name: 'Artist',
        value: 'Miles Davis',
      },
    ]);
  });

  it('sends book notifications with Open Library metadata', async (t) => {
    const sendNotificationMock = mock.method(
      notificationManager,
      'sendNotification',
      () => undefined
    );
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL45804W',
          title: 'The Left Hand of Darkness',
          first_publish_date: '1969',
          description: 'A classic science fiction novel.',
          covers: [1234],
        } as Awaited<ReturnType<OpenLibraryAPI['getWork']>>)
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
        } as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>)
    );
    t.after(() => {
      sendNotificationMock.mock.restore();
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
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
    const entity = new MediaRequest({
      type: MediaType.BOOK,
      media,
      requestedBy: await getFriendUser(),
      status: MediaRequestStatus.APPROVED,
      is4k: false,
    });

    await MediaRequest.sendNotification(
      entity,
      media,
      Notification.MEDIA_AVAILABLE
    );

    assert.strictEqual(sendNotificationMock.mock.callCount(), 1);
    const [type, payload] = sendNotificationMock.mock.calls[0]
      .arguments as [Notification, NotificationPayload];
    assert.strictEqual(type, Notification.MEDIA_AVAILABLE);
    assert.strictEqual(payload.event, 'Book Now Available');
    assert.strictEqual(payload.subject, 'The Left Hand of Darkness (1969)');
    assert.strictEqual(payload.message, 'A classic science fiction novel.');
    assert.strictEqual(
      payload.image,
      'https://covers.openlibrary.org/b/id/1234-L.jpg'
    );
    assert.deepStrictEqual(payload.extra, [
      {
        name: 'ISBN',
        value: '9780441478125',
      },
    ]);
  });
});

describe('MediaRequest.request', () => {
  it('uses default Lidarr settings when requesting music without overrides', async (t) => {
    const settings = getSettings();
    const originalLidarr = settings.lidarr;
    settings.lidarr = [
      {
        id: 9,
        name: 'Default Lidarr',
        hostname: '127.0.0.1',
        port: 8686,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Lossless',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/music',
        tags: [3, 4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'defaulted-release-group',
        } as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>)
    );
    t.after(() => {
      settings.lidarr = originalLidarr;
      getAlbumMock.mock.restore();
    });

    const mediaRequest = await MediaRequest.request(
      {
        mediaType: MediaType.MUSIC,
        mediaId: 'listenbrainz-release-id',
      },
      await getFriendUser()
    );

    assert.strictEqual(mediaRequest.serverId, 9);
    assert.strictEqual(mediaRequest.profileId, 11);
    assert.strictEqual(mediaRequest.metadataProfileId, 12);
    assert.strictEqual(mediaRequest.rootFolder, '/music');
    assert.deepStrictEqual(mediaRequest.tags, [3, 4]);
  });
});
