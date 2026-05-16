import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isMatchingReadarrDownloadServer } from '@server/lib/downloadtracker';

describe('DownloadTracker Bookshelf queues', () => {
  it('does not treat ebook and audiobook Bookshelf configs as duplicate queue sources', () => {
    const baseServer = {
      hostname: 'bookshelf.local',
      port: 8787,
      baseUrl: '',
    };

    assert.strictEqual(
      isMatchingReadarrDownloadServer(
        { ...baseServer, serviceType: 'ebook' },
        { ...baseServer, serviceType: 'ebook' }
      ),
      true
    );
    assert.strictEqual(
      isMatchingReadarrDownloadServer(
        { ...baseServer, serviceType: 'ebook' },
        { ...baseServer, serviceType: 'audiobook' }
      ),
      false
    );
    assert.strictEqual(
      isMatchingReadarrDownloadServer(
        { ...baseServer },
        { ...baseServer, serviceType: 'ebook' }
      ),
      true
    );
  });
});
