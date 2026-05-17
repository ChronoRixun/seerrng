import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canRegisterServiceWorker,
  shouldVerifyPushSubscription,
} from './registration';

describe('canRegisterServiceWorker', () => {
  it('allows service worker registration without a logged-in user', () => {
    assert.equal(
      canRegisterServiceWorker({
        serviceWorker: {},
      } as Pick<Navigator, 'serviceWorker'>),
      true
    );
  });

  it('skips registration when the browser does not support service workers', () => {
    assert.equal(
      canRegisterServiceWorker({} as Pick<Navigator, 'serviceWorker'>),
      false
    );
    assert.equal(canRegisterServiceWorker(undefined), false);
  });
});

describe('shouldVerifyPushSubscription', () => {
  it('keeps push resubscribe gated by user and local preference', () => {
    assert.equal(
      shouldVerifyPushSubscription({
        pushNotificationsEnabled: true,
        userId: 1,
      }),
      true
    );
    assert.equal(
      shouldVerifyPushSubscription({
        pushNotificationsEnabled: true,
        userId: undefined,
      }),
      false
    );
    assert.equal(
      shouldVerifyPushSubscription({
        pushNotificationsEnabled: false,
        userId: 1,
      }),
      false
    );
  });
});
