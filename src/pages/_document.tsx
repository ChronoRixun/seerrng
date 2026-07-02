import type { ThemeMode } from '@app/context/ThemeContext';
import {
  getThemeCssVars,
  THEME_COOKIE_KEY,
  THEME_VARS_KEY,
  themePalettes,
} from '@app/context/ThemeContext';
import type { DocumentContext, DocumentInitialProps } from 'next/document';
import Document, { Head, Html, Main, NextScript } from 'next/document';

import type { CSSProperties, JSX } from 'react';

const clientBuildVersion = process.env.commitTag ?? 'local';

type ThemeDocumentProps = DocumentInitialProps & {
  themeMode: ThemeMode;
  themePaletteId: string;
  themeVars: Record<string, string>;
};

// Resolves the user's stored theme from the cookie mirror written by
// ThemeContext so the initial HTML paints with the right theme instead of
// flashing the default dark/aurora palette before hydration.
const resolveThemeFromCookie = (
  cookieHeader: string | undefined
): { mode: ThemeMode; palette: string } => {
  let mode: ThemeMode = 'dark';
  let palette = themePalettes[0].id;

  const cookieValue = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${THEME_COOKIE_KEY}=`))
    ?.slice(THEME_COOKIE_KEY.length + 1);

  if (cookieValue) {
    const [cookieMode, cookiePalette] = cookieValue.split(':');

    if (cookieMode === 'light' || cookieMode === 'dark') {
      mode = cookieMode;
    }

    if (
      themePalettes.some((themePalette) => themePalette.id === cookiePalette)
    ) {
      palette = cookiePalette;
    }
  }

  return { mode, palette };
};

// Statically prerendered pages (e.g. /login) are built without a request, so
// the cookie-based SSR theme above can't apply there. This blocking script
// restores the exact theme variables persisted by applyTheme before first
// paint instead.
const themeBootstrapScript = `
(function () {
  try {
    var raw = window.localStorage.getItem(${JSON.stringify(THEME_VARS_KEY)});
    if (!raw) {
      return;
    }

    var stored = JSON.parse(raw);
    if (
      !stored ||
      (stored.mode !== 'light' && stored.mode !== 'dark') ||
      typeof stored.vars !== 'object' ||
      stored.vars === null
    ) {
      return;
    }

    var root = document.documentElement;
    root.dataset.themeMode = stored.mode;
    if (typeof stored.palette === 'string') {
      root.dataset.themePalette = stored.palette;
    }
    root.classList.toggle('dark', stored.mode === 'dark');
    Object.keys(stored.vars).forEach(function (name) {
      if (/^--[a-z0-9-]+$/i.test(name) && typeof stored.vars[name] === 'string') {
        root.style.setProperty(name, stored.vars[name]);
      }
    });
  } catch (error) {
    // ignore malformed stored theme state
  }
})();
`;

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

class MyDocument extends Document<ThemeDocumentProps> {
  static async getInitialProps(
    ctx: DocumentContext
  ): Promise<ThemeDocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    const { mode, palette } = resolveThemeFromCookie(ctx.req?.headers?.cookie);
    const { activePaletteId, vars } = getThemeCssVars(mode, palette);

    return {
      ...initialProps,
      themeMode: mode,
      themePaletteId: activePaletteId,
      themeVars: vars,
    };
  }

  render(): JSX.Element {
    const { themeMode, themePaletteId, themeVars } = this.props;

    return (
      <Html
        className={themeMode === 'dark' ? 'dark' : undefined}
        data-theme-mode={themeMode}
        data-theme-palette={themePaletteId}
        style={themeVars as CSSProperties}
      >
        <Head>
          <script
            dangerouslySetInnerHTML={{
              __html: themeBootstrapScript,
            }}
          />
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
