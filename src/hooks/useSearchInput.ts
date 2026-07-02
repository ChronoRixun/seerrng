import type { Nullable } from '@app/utils/typeHelpers';
import { useRouter } from 'next/router';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UrlObject } from 'url';
import useDebouncedState from './useDebouncedState';

type Url = string | UrlObject;

interface SearchObject {
  searchValue: string;
  searchOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  setSearchValue: Dispatch<SetStateAction<string>>;
  clear: () => void;
}

const useSearchInput = (): SearchObject => {
  const router = useRouter();
  const [searchOpen, setIsOpen] = useState(false);
  const [lastRoute, setLastRoute] = useState<Nullable<Url>>(null);
  const [searchValue, debouncedValue, setSearchValue] = useDebouncedState(
    (router.query.query as string) ?? ''
  );
  // Navigations initiated by this hook. While one is in flight the router
  // query is stale relative to what the user typed, so the URL→input sync
  // below must not run — it would erase pending keystrokes and jump the
  // cursor.
  const pendingSelfNavigations = useRef(0);
  // The router query as of the last sync pass. The input is only synced
  // from the URL when this actually changes — otherwise clearing the input
  // would resurrect the stale query still sitting in the URL.
  const lastRouterQuery = useRef(router.query.query);

  const trackSelfNavigation = useCallback((navigation: Promise<unknown>) => {
    pendingSelfNavigations.current += 1;
    navigation
      .catch(() => undefined)
      .finally(() => {
        pendingSelfNavigations.current -= 1;
      });
  }, []);

  /**
   * This effect handles routing when the debounced search input
   * value changes.
   *
   * If we are not already on the /search route, then we push
   * in a new route. If we are, then we only replace the history.
   */
  useEffect(() => {
    if (debouncedValue !== '' && searchOpen) {
      if (router.pathname.startsWith('/search')) {
        // Skip when the URL already matches: this effect re-runs on every
        // route change (router identity changes), and replacing
        // unconditionally creates an endless replace loop that starves
        // other navigations.
        if (router.query.query === debouncedValue) {
          return;
        }

        // Shallow: the search page fetches results client-side from the
        // query, so a server round-trip per keystroke is pure latency.
        trackSelfNavigation(
          router.replace(
            {
              pathname: router.pathname,
              query: {
                ...router.query,
                query: debouncedValue,
              },
            },
            undefined,
            { shallow: true }
          )
        );
      } else {
        setLastRoute(router.asPath);
        trackSelfNavigation(
          router
            .push({
              pathname: '/search',
              query: { query: debouncedValue },
            })
            .then(() => window.scrollTo(0, 0))
        );
      }
    } else if (
      debouncedValue === '' &&
      searchOpen &&
      router.pathname.startsWith('/search') &&
      router.query.query &&
      // Never while another of our navigations is in flight — a shallow
      // replace here would cancel e.g. the navigate-back-on-close.
      pendingSelfNavigations.current === 0
    ) {
      // The input was cleared while staying on the search page: drop the
      // stale query from the URL too, so a page refresh (or any later
      // URL→input sync) cannot resurrect it.
      const remainingQuery = { ...router.query };
      delete remainingQuery.query;

      trackSelfNavigation(
        router.replace(
          {
            pathname: router.pathname,
            query: remainingQuery,
          },
          undefined,
          { shallow: true }
        )
      );
    }
  }, [debouncedValue, router, searchOpen, trackSelfNavigation]);

  /**
   * This effect is handling behavior when the search input is closed.
   *
   * If we have a lastRoute, we will route back to it. If we don't
   * (in the case of a deeplink) we take the user back to the index route
   */
  useEffect(() => {
    if (
      searchValue === '' &&
      router.pathname.startsWith('/search') &&
      !searchOpen
    ) {
      if (lastRoute) {
        trackSelfNavigation(
          router.push(lastRoute).then(() => window.scrollTo(0, 0))
        );
      } else {
        trackSelfNavigation(
          router.replace('/').then(() => window.scrollTo(0, 0))
        );
      }
    }
  }, [lastRoute, router, searchOpen, searchValue, trackSelfNavigation]);

  /**
   * This effect syncs the searchbox with external URL changes (browser
   * back/forward, deeplinks to /search).
   *
   * The sync is skipped while one of our own navigations is still in
   * flight or while the user has typed something newer than the debounced
   * value — in both cases the router query is stale and overwriting the
   * input from it would drop the user's keystrokes.
   *
   * We also want the search to always be open while the user is on /search.
   */
  useEffect(() => {
    const routerQuery = router.query.query;
    const routerQueryChanged = routerQuery !== lastRouterQuery.current;
    lastRouterQuery.current = routerQuery;
    const inputIsSettled = searchValue === debouncedValue;

    if (
      routerQueryChanged &&
      inputIsSettled &&
      pendingSelfNavigations.current === 0 &&
      routerQuery !== debouncedValue
    ) {
      setSearchValue((routerQuery as string) ?? '');

      if (!router.pathname.startsWith('/search') && !routerQuery) {
        setIsOpen(false);
      }
    }

    if (router.pathname.startsWith('/search')) {
      setIsOpen(true);
    }
  }, [debouncedValue, router, searchValue, setSearchValue]);

  // Clearing empties the input but keeps the search open so the user can
  // immediately type a new query; navigating back to the previous route
  // still happens when the empty input is closed (blurred).
  const clear = useCallback(() => {
    setSearchValue('');
  }, [setSearchValue]);

  return useMemo(
    () => ({
      searchValue,
      searchOpen,
      setIsOpen,
      setSearchValue,
      clear,
    }),
    [clear, searchOpen, searchValue, setSearchValue]
  );
};

export default useSearchInput;
