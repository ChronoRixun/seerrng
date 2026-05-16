/* eslint-disable no-console */

import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import { verifyAndResubscribePushSubscription } from '@app/utils/pushSubscriptionHelpers';
import { useEffect, useMemo } from 'react';

const ServiceWorkerSetup = () => {
  const { user } = useUser();
  const { currentSettings } = useSettings();
  const userId = user?.id;
  const pushSettings = useMemo(
    () => ({
      enablePushRegistration: currentSettings.enablePushRegistration,
      vapidPublic: currentSettings.vapidPublic,
    }),
    [currentSettings.enablePushRegistration, currentSettings.vapidPublic]
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !userId) {
      return;
    }

    const registerServiceWorker = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then(async (registration) => {
          console.log(
            '[SW] Registration successful, scope is:',
            registration.scope
          );

          const pushNotificationsEnabled =
            localStorage.getItem('pushNotificationsEnabled') === 'true';

          // Reset the notifications flag if permissions were revoked
          if (
            Notification.permission !== 'granted' &&
            pushNotificationsEnabled
          ) {
            localStorage.setItem('pushNotificationsEnabled', 'false');
            console.warn(
              '[SW] Push permissions not granted — skipping resubscribe'
            );

            return;
          }

          // Bypass resubscribing if we have manually disabled push notifications
          if (!pushNotificationsEnabled) {
            return;
          }

          const subscription = await registration.pushManager.getSubscription();

          console.log(
            '[SW] Existing push subscription:',
            subscription?.endpoint
          );

          const verified = await verifyAndResubscribePushSubscription(
            userId,
            pushSettings
          );

          if (verified) {
            console.log('[SW] Push subscription verified or refreshed.');
          } else {
            console.warn(
              '[SW] Push subscription verification failed or not available.'
            );
          }
        })
        .catch(function (error) {
          console.log('[SW] Service worker registration failed, error:', error);
        });
    };

    if ('requestIdleCallback' in window) {
      const idleCallback = window.requestIdleCallback(registerServiceWorker, {
        timeout: 5000,
      });

      return () => window.cancelIdleCallback(idleCallback);
    }

    const timeout = globalThis.setTimeout(registerServiceWorker, 2000);

    return () => globalThis.clearTimeout(timeout);
  }, [pushSettings, userId]);
  return null;
};

export default ServiceWorkerSetup;
