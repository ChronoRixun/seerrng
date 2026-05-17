import type { DocumentContext, DocumentInitialProps } from 'next/document';
import Document, { Head, Html, Main, NextScript } from 'next/document';

import type { JSX } from 'react';

const clientBuildVersion = process.env.commitTag ?? 'local';

const staleServiceWorkerCleanupScript = `
(function () {
  var buildVersion = ${JSON.stringify(clientBuildVersion)};
  var versionKey = 'seerrng:client-build-version';
  var reloadKey = 'seerrng:stale-sw-reload:' + buildVersion;

  try {
    if (!buildVersion || buildVersion === 'local') {
      return;
    }

    var previousVersion = window.localStorage.getItem(versionKey);

    if (previousVersion === buildVersion) {
      return;
    }

    window.localStorage.setItem(versionKey, buildVersion);

    if (window.sessionStorage.getItem(reloadKey) === 'done') {
      return;
    }

    window.sessionStorage.setItem(reloadKey, 'done');

    var clearRuntimeCaches = 'caches' in window
      ? window.caches.keys().then(function (cacheNames) {
          return Promise.all(cacheNames.map(function (cacheName) {
            return /^runtime/.test(cacheName) || /^offline-/.test(cacheName)
              ? window.caches.delete(cacheName)
              : Promise.resolve(false);
          }));
        })
      : Promise.resolve();

    var unregisterWorkers = 'serviceWorker' in navigator
      ? navigator.serviceWorker.getRegistrations().then(function (registrations) {
          return Promise.all(registrations.map(function (registration) {
            var worker = registration.active || registration.waiting || registration.installing;
            var scriptUrl = worker && worker.scriptURL ? new URL(worker.scriptURL) : null;

            return scriptUrl && scriptUrl.pathname === '/sw.js'
              ? registration.unregister()
              : Promise.resolve(false);
          }));
        })
      : Promise.resolve();

    Promise.all([clearRuntimeCaches, unregisterWorkers]).finally(function () {
      window.location.reload();
    });
  } catch (error) {
    window.localStorage.setItem(versionKey, buildVersion);
  }
})();
`;

class MyDocument extends Document {
  static async getInitialProps(
    ctx: DocumentContext
  ): Promise<DocumentInitialProps> {
    const initialProps = await Document.getInitialProps(ctx);

    return initialProps;
  }

  render(): JSX.Element {
    return (
      <Html>
        <Head>
          <script
            dangerouslySetInnerHTML={{
              __html: staleServiceWorkerCleanupScript,
            }}
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
