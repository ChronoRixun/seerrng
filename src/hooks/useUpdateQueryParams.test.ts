import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import type { NextRouter } from 'next/router';
import {
  filterQueryString,
  mergeQueryString,
} from './useUpdateQueryParams';

const createRouter = (overrides: Partial<NextRouter>): NextRouter =>
  ({
    asPath: '/',
    basePath: '',
    beforePopState: () => undefined,
    back: () => undefined,
    defaultLocale: undefined,
    domainLocales: undefined,
    events: {
      emit: () => undefined,
      off: () => undefined,
      on: () => undefined,
    },
    isFallback: false,
    isLocaleDomain: false,
    isPreview: false,
    isReady: true,
    locale: undefined,
    locales: undefined,
    pathname: '/',
    prefetch: async () => undefined,
    push: async () => true,
    query: {},
    reload: () => undefined,
    replace: async () => true,
    route: '/',
    ...overrides,
  }) as NextRouter;

describe('filterQueryString', () => {
  it('removes only exact dynamic route params from the query', () => {
    const router = createRouter({
      pathname: '/users/[userId]',
      query: {
        userId: '7',
        id: 'should-stay',
        page: '2',
      },
    });

    const filtered = filterQueryString(router, router.query);

    strictEqual(filtered.userId, undefined);
    strictEqual(filtered.id, 'should-stay');
    strictEqual(filtered.page, '2');
  });
});

describe('mergeQueryString', () => {
  it('encodes query keys and values when building routes', () => {
    const router = createRouter({
      asPath: '/discover/books?subject=old',
      pathname: '/discover/books',
      query: { subject: 'old' },
    });

    const route = mergeQueryString(router, {
      query: 'space opera & fantasy',
      subject: 'science/fiction',
    });

    strictEqual(
      route.pathname,
      '/discover/books?subject=science%2Ffiction&query=space+opera+%26+fantasy'
    );
    strictEqual(
      route.path,
      '/discover/books?subject=science%2Ffiction&query=space+opera+%26+fantasy'
    );
  });

  it('omits removed and empty query values while preserving arrays', () => {
    const router = createRouter({
      asPath: '/requests?page=4&filter=all',
      pathname: '/requests',
      query: { page: '4', filter: 'all' },
    });

    const route = mergeQueryString(router, {
      page: undefined,
      filter: '',
      status: ['approved', '', 'pending'],
    });

    strictEqual(route.pathname, '/requests?status=approved&status=pending');
    strictEqual(route.path, '/requests?status=approved&status=pending');
  });
});
