import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWRInfinite from 'swr/infinite';
import useSettings from './useSettings';
import { Permission, useUser } from './useUser';
import useWarmImageCache from './useWarmImageCache';

export interface BaseSearchResult<T> {
  page: number;
  totalResults: number;
  totalPages: number;
  results: T[];
}

interface BaseMedia {
  id: number | string;
  mediaType: string;
  mediaInfo?: {
    status: MediaStatus;
    serviceId?: number | null;
    externalServiceId?: number | null;
    audiobookServiceId?: number | null;
    audiobookExternalServiceId?: number | null;
    requests?: {
      status: MediaRequestStatus;
      bookFormat?: 'ebook' | 'audiobook' | 'both' | null;
    }[];
  };
}

interface DiscoverResult<T, S> {
  isLoadingInitialData: boolean;
  isLoadingMore: boolean;
  fetchMore: () => void;
  isEmpty: boolean;
  isReachingEnd: boolean;
  error: unknown;
  titles: T[];
  firstResultData?: BaseSearchResult<T> & S;
  mutate?: () => void;
}

const FILTERED_EMPTY_PAGE_SCAN_LIMIT = 10;

const extraEncodes: [RegExp, string][] = [
  [/\(/g, '%28'],
  [/\)/g, '%29'],
  [/!/g, '%21'],
  [/\*/g, '%2A'],
];

export const encodeURIExtraParams = (string: string): string => {
  let finalString = encodeURIComponent(string);

  extraEncodes.forEach((encode) => {
    finalString = finalString.replace(encode[0], encode[1]);
  });

  return finalString;
};

const getShuffleSeed = (): string => Math.random().toString(36).slice(2);

const hasLinkedBookFormat = (
  mediaInfo: NonNullable<BaseMedia['mediaInfo']>,
  format: 'ebook' | 'audiobook'
) => {
  if (format === 'audiobook') {
    return (
      mediaInfo.audiobookServiceId !== null &&
      mediaInfo.audiobookServiceId !== undefined &&
      mediaInfo.audiobookExternalServiceId !== null &&
      mediaInfo.audiobookExternalServiceId !== undefined
    );
  }

  return (
    mediaInfo.serviceId !== null &&
    mediaInfo.serviceId !== undefined &&
    mediaInfo.externalServiceId !== null &&
    mediaInfo.externalServiceId !== undefined
  );
};

const hasActiveBookRequest = (
  mediaInfo: NonNullable<BaseMedia['mediaInfo']>,
  format: 'ebook' | 'audiobook'
) => {
  return (mediaInfo.requests ?? []).some((request) => {
    if (
      request.status === MediaRequestStatus.DECLINED ||
      request.status === MediaRequestStatus.COMPLETED
    ) {
      return false;
    }

    const requestFormat = request.bookFormat ?? 'ebook';

    return requestFormat === 'both' || requestFormat === format;
  });
};

const isMissingBookFormat = (item: BaseMedia) => {
  if (
    item.mediaType !== 'book' ||
    !item.mediaInfo ||
    item.mediaInfo.status === MediaStatus.BLOCKLISTED
  ) {
    return false;
  }

  const hasEbook =
    hasLinkedBookFormat(item.mediaInfo, 'ebook') ||
    hasActiveBookRequest(item.mediaInfo, 'ebook');
  const hasAudiobook =
    hasLinkedBookFormat(item.mediaInfo, 'audiobook') ||
    hasActiveBookRequest(item.mediaInfo, 'audiobook');

  return !hasEbook || !hasAudiobook;
};

const getMediaResultKey = (item: BaseMedia): string =>
  `${item.mediaType}:${item.id}`;

const useDiscover = <
  T extends BaseMedia,
  S = Record<string, never>,
  O = Record<string, unknown>,
>(
  endpoint: string,
  options?: O,
  { hideAvailable = true, hideBlocklisted = true, randomizeOrder = false } = {}
): DiscoverResult<T, S> => {
  const settings = useSettings();
  const { hasPermission } = useUser();
  const { addToast } = useToasts();
  const intl = useIntl();
  const [shuffleSeed, setShuffleSeed] = useState(getShuffleSeed);
  const {
    data,
    error,
    size,
    setSize,
    isValidating,
    mutate: revalidate,
  } = useSWRInfinite<
    BaseSearchResult<T> & S
  >(
    (pageIndex: number, previousPageData) => {
      if (previousPageData && pageIndex + 1 > previousPageData.totalPages) {
        return null;
      }

      const params: Record<string, unknown> = {
        page: pageIndex + 1,
        ...options,
      };

      if (randomizeOrder) {
        params.shuffleSeed = shuffleSeed;
      }

      const finalQueryString = Object.keys(params)
        .map(
          (paramKey) =>
            `${paramKey}=${encodeURIExtraParams(String(params[paramKey]))}`
        )
        .join('&');

      return `${endpoint}?${finalQueryString}`;
    },
    {
      initialSize: 1,
      revalidateFirstPage: false,
      dedupingInterval: 30000,
      revalidateOnFocus: false,
    }
  );

  const isLoadingInitialData = !data && !error;
  const isLoadingMore =
    isLoadingInitialData ||
    (size > 0 &&
      !!data &&
      typeof data[size - 1] === 'undefined' &&
      isValidating);

  const fetchMore = useCallback(() => {
    setSize((currentSize) => currentSize + 1);
  }, [setSize]);

  const mutate = useCallback(() => {
    if (randomizeOrder) {
      setSize(1);
      setShuffleSeed(getShuffleSeed());
      return;
    }

    void revalidate();
  }, [randomizeOrder, revalidate, setSize]);

  const canViewBlocklist = hasPermission(
    [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
    { type: 'or' }
  );
  const titles = useMemo(() => {
    const resultKeys = new Set<string>();
    let filteredTitles: T[] = [];

    for (const page of data ?? []) {
      for (const result of page.results) {
        const resultKey = getMediaResultKey(result);

        if (!resultKeys.has(resultKey)) {
          resultKeys.add(resultKey);
          filteredTitles.push(result);
        }
      }
    }

    if (settings.currentSettings.hideAvailable && hideAvailable) {
      filteredTitles = filteredTitles.filter(
        (i) =>
          !i.mediaInfo ||
          !(
            i.mediaInfo.status === MediaStatus.AVAILABLE ||
            i.mediaInfo.status === MediaStatus.PARTIALLY_AVAILABLE
          ) ||
          isMissingBookFormat(i)
      );
    }

    if (
      hideBlocklisted &&
      (settings.currentSettings.hideBlocklisted || !canViewBlocklist)
    ) {
      filteredTitles = filteredTitles.filter(
        (i) => !i.mediaInfo || i.mediaInfo.status !== MediaStatus.BLOCKLISTED
      );
    }

    return filteredTitles;
  }, [
    canViewBlocklist,
    data,
    hideAvailable,
    hideBlocklisted,
    settings.currentSettings.hideAvailable,
    settings.currentSettings.hideBlocklisted,
  ]);
  useWarmImageCache(titles);

  const rawResultCount = useMemo(
    () =>
      (data ?? []).reduce((total, page) => total + page.results.length, 0),
    [data]
  );
  const lastResultPage = data?.[data.length - 1];
  const hasMoreUnfilteredResults =
    !!lastResultPage &&
    lastResultPage.results.length >= 20 &&
    lastResultPage.totalResults > size * 20;
  const shouldScanNextFilteredPage =
    !isLoadingInitialData &&
    !isLoadingMore &&
    !isValidating &&
    titles.length === 0 &&
    rawResultCount > 0 &&
    hasMoreUnfilteredResults &&
    size < FILTERED_EMPTY_PAGE_SCAN_LIMIT;
  const isEmpty =
    !isLoadingInitialData &&
    titles.length === 0 &&
    !shouldScanNextFilteredPage;
  const isReachingEnd =
    (!!data && (lastResultPage?.results.length ?? 0) < 20) ||
    (!!data && (lastResultPage?.totalResults ?? 0) <= size * 20) ||
    (!!data && (lastResultPage?.totalResults ?? 0) < 41) ||
    (titles.length === 0 &&
      rawResultCount > 0 &&
      size >= FILTERED_EMPTY_PAGE_SCAN_LIMIT);

  useEffect(() => {
    if (shouldScanNextFilteredPage) {
      setSize((currentSize) => currentSize + 1);
    }
  }, [setSize, shouldScanNextFilteredPage]);

  useEffect(() => {
    if (error && titles.length) {
      addToast(intl.formatMessage(globalMessages.error), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  }, [data, error, addToast, intl, titles.length]);

  return {
    isLoadingInitialData,
    isLoadingMore,
    fetchMore,
    isEmpty,
    isReachingEnd,
    error: error && titles.length ? null : error,
    titles,
    firstResultData: data?.[0],
    mutate,
  };
};

export default useDiscover;
