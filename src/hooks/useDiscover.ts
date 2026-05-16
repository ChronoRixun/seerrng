import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { useCallback, useEffect, useMemo } from 'react';
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
  { hideAvailable = true, hideBlocklisted = true } = {}
): DiscoverResult<T, S> => {
  const settings = useSettings();
  const { hasPermission } = useUser();
  const { addToast } = useToasts();
  const intl = useIntl();
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<
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

      const finalQueryString = Object.keys(params)
        .map(
          (paramKey) =>
            `${paramKey}=${encodeURIExtraParams(params[paramKey] as string)}`
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

  const canManageBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);
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
      settings.currentSettings.hideBlocklisted &&
      hideBlocklisted &&
      canManageBlocklist
    ) {
      filteredTitles = filteredTitles.filter(
        (i) => !i.mediaInfo || i.mediaInfo.status !== MediaStatus.BLOCKLISTED
      );
    }

    return filteredTitles;
  }, [
    canManageBlocklist,
    data,
    hideAvailable,
    hideBlocklisted,
    settings.currentSettings.hideAvailable,
    settings.currentSettings.hideBlocklisted,
  ]);
  useWarmImageCache(titles);

  const isEmpty = !isLoadingInitialData && titles?.length === 0;
  const isReachingEnd =
    isEmpty ||
    (!!data && (data[data?.length - 1]?.results.length ?? 0) < 20) ||
    (!!data && (data[data?.length - 1]?.totalResults ?? 0) <= size * 20) ||
    (!!data && (data[data?.length - 1]?.totalResults ?? 0) < 41);

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
