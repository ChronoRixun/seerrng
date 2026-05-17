/* eslint-disable no-undef */
// Incrementing OFFLINE_VERSION will kick off the install event and force
// previously cached resources to be updated from the network.
// This variable is intentionally declared and unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const OFFLINE_VERSION = 5;
const CACHE_NAME = 'offline';
const RUNTIME_CACHE_NAME = 'runtime-v1';
const RUNTIME_CACHE_MAX_ENTRIES = 400;
// Customize this with a different URL if needed.
const OFFLINE_URL = '/offline.html';

const CACHEABLE_API_PATHS = [
  /^\/api\/v1\/settings\/public$/,
  /^\/api\/v1\/settings\/discover$/,
  /^\/api\/v1\/discover(?:\/|$)/,
  /^\/api\/v1\/search(?:\/|$)/,
  /^\/api\/v1\/movie\/\d+/,
  /^\/api\/v1\/tv\/\d+/,
  /^\/api\/v1\/collection\/\d+/,
  /^\/api\/v1\/person\/\d+/,
  /^\/api\/v1\/music\/[^/]+/,
  /^\/api\/v1\/book\/[^/]+/,
  /^\/api\/v1\/author\/[^/]+/,
  /^\/api\/v1\/artist\/[^/]+/,
];

const CACHEABLE_STATIC_PATHS = [
  /^\/imageproxy\//,
  /^\/avatarproxy\//,
  /^\/_next\/static\//,
  /^\/offline\.html$/,
  /^\/site\.webmanifest$/,
  /^\/robots\.txt$/,
  /^\/favicon\.ico$/,
  /\.(aac|avif|css|flac|gif|ico|jpg|jpeg|js|m4a|map|mjs|mp3|mp4|oga|ogg|ogv|opus|otf|png|svg|ttf|wasm|wav|webm|webp|woff|woff2|json|txt|vtt|xml)$/i,
];

const isRuntimeCacheableRequest = (request) => {
  if (request.method !== 'GET') {
    return false;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return false;
  }

  return [...CACHEABLE_API_PATHS, ...CACHEABLE_STATIC_PATHS].some((pattern) =>
    pattern.test(url.pathname)
  );
};

const isRuntimeCacheableResponse = (response) =>
  response &&
  response.ok &&
  response.status === 200 &&
  (response.type === 'basic' || response.type === 'default');

const trimRuntimeCache = async (cache) => {
  const keys = await cache.keys();

  if (keys.length <= RUNTIME_CACHE_MAX_ENTRIES) {
    return;
  }

  await Promise.all(
    keys
      .slice(0, keys.length - RUNTIME_CACHE_MAX_ENTRIES)
      .map((request) => cache.delete(request))
  );
};

const cacheRuntimeResponse = async (request, response) => {
  if (!isRuntimeCacheableResponse(response)) {
    return;
  }

  try {
    const cache = await caches.open(RUNTIME_CACHE_NAME);
    await cache.put(request, response.clone());
    await trimRuntimeCache(cache);
  } catch {
    // Runtime caching is opportunistic and should never break the request.
  }
};

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(RUNTIME_CACHE_NAME);
  const cachedResponse = await cache.match(request);
  const networkResponsePromise = fetch(request)
    .then(async (networkResponse) => {
      await cacheRuntimeResponse(request, networkResponse);
      return networkResponse;
    })
    .catch(() => undefined);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkResponsePromise;

  if (networkResponse) {
    return networkResponse;
  }

  return fetch(request);
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Setting {cache: 'reload'} in the new request will ensure that the
      // response isn't fulfilled from the HTTP cache; i.e., it will be from
      // the network.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    })()
  );
  // Force the waiting service worker to become the active service worker.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Enable navigation preload if it's supported.
      // See https://developers.google.com/web/updates/2017/02/navigation-preload
      if ('navigationPreload' in self.registration) {
        await self.registration.navigationPreload.enable();
      }

      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => ![CACHE_NAME, RUNTIME_CACHE_NAME].includes(key))
          .map((key) => caches.delete(key))
      );
    })()
  );

  // Tell the active service worker to take control of the page immediately.
  clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (isRuntimeCacheableRequest(event.request)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // We only want to call event.respondWith() if this is a navigation request
  // for an HTML page.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // First, try to use the navigation preload response if it's supported.
          const preloadResponse = await event.preloadResponse;
          if (preloadResponse) {
            return preloadResponse;
          }

          // Always try the network first.
          const networkResponse = await fetch(event.request);
          return networkResponse;
        } catch (error) {
          // catch is only triggered if an exception is thrown, which is likely
          // due to a network error.
          // If fetch() returns a valid HTTP response with a response code in
          // the 4xx or 5xx range, the catch() will NOT be called.
          // eslint-disable-next-line no-console
          console.log('Fetch failed; returning offline page instead.', error);

          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match(OFFLINE_URL);
          return cachedResponse;
        }
      })()
    );
  }
});

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};

  const options = {
    body: payload.message,
    badge: 'badge-128x128.png',
    icon: payload.image ? payload.image : 'android-chrome-192x192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '2',
      actionUrl: payload.actionUrl,
      requestId: payload.requestId,
    },
    actions: [],
  };

  if (payload.actionUrl) {
    options.actions.push({
      action: 'view',
      title: payload.actionUrlTitle ?? 'View',
    });
  }

  if (payload.notificationType === 'MEDIA_PENDING') {
    options.actions.push(
      {
        action: 'approve',
        title: 'Approve',
      },
      {
        action: 'decline',
        title: 'Decline',
      }
    );
  }

  // Set the badge with the amount of pending requests
  // Only update the badge if the payload confirms they are the admin
  if (
    (payload.notificationType === 'MEDIA_APPROVED' ||
      payload.notificationType === 'MEDIA_DECLINED') &&
    payload.isAdmin
  ) {
    if ('setAppBadge' in navigator) {
      navigator.setAppBadge(payload.pendingRequestsCount);
    }
    return;
  }

  if (payload.notificationType === 'MEDIA_PENDING') {
    if ('setAppBadge' in navigator) {
      navigator.setAppBadge(payload.pendingRequestsCount);
    }
  }

  event.waitUntil(self.registration.showNotification(payload.subject, options));
});

self.addEventListener(
  'notificationclick',
  (event) => {
    const notificationData = event.notification.data;

    event.notification.close();

    if (event.action === 'approve') {
      fetch(`/api/v1/request/${notificationData.requestId}/approve`, {
        method: 'POST',
      });
    } else if (event.action === 'decline') {
      fetch(`/api/v1/request/${notificationData.requestId}/decline`, {
        method: 'POST',
      });
    }

    if (notificationData.actionUrl) {
      clients.openWindow(notificationData.actionUrl);
    }
  },
  false
);
