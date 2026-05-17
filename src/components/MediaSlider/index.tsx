import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import ShowMoreCard from '@app/components/MediaSlider/ShowMoreCard';
import PersonCard from '@app/components/PersonCard';
import Slider from '@app/components/Slider';
import TitleCard from '@app/components/TitleCard';
import useCardTextVisibility from '@app/hooks/useCardTextVisibility';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import useWarmImageCache from '@app/hooks/useWarmImageCache';
import {
  ArrowPathIcon,
  ArrowRightCircleIcon,
} from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import { Permission } from '@server/lib/permissions';
import type {
  AlbumResult,
  ArtistResult,
  BookResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { appendDiscoverQueryString } from '@server/utils/discoverQuery';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import useSWRInfinite from 'swr/infinite';

interface MixedResult {
  page: number;
  totalResults: number;
  totalPages: number;
  results: (
    | TvResult
    | MovieResult
    | PersonResult
    | AlbumResult
    | ArtistResult
    | BookResult
  )[];
}

interface MediaSliderProps {
  title: string;
  url: string;
  linkUrl?: string;
  sliderKey: string;
  hideWhenEmpty?: boolean;
  extraParams?: string;
  onNewTitles?: (titleCount: number) => void;
  randomizeOrder?: boolean;
}

type SliderTitle =
  | TvResult
  | MovieResult
  | PersonResult
  | AlbumResult
  | ArtistResult
  | BookResult;

const getMediaResultKey = (item: SliderTitle): string =>
  `${item.mediaType}:${item.id}`;

const MediaSlider = ({
  title,
  url,
  linkUrl,
  extraParams,
  sliderKey,
  hideWhenEmpty = false,
  onNewTitles,
  randomizeOrder = false,
}: MediaSliderProps) => {
  const settings = useSettings();
  const { visibility } = useCardTextVisibility();
  const { hasPermission } = useUser();
  const { ref, inView } = useInView({
    rootMargin: '450px 0px',
    triggerOnce: true,
  });
  const shouldLoad = isEditingSafe() || inView;
  const [shuffleSeed, setShuffleSeed] = useState(() =>
    Math.random().toString(36).slice(2)
  );
  const getKey = useCallback(
    (pageIndex: number, previousPageData: MixedResult | null) => {
      if (!shouldLoad) {
        return null;
      }

      if (previousPageData && pageIndex + 1 > previousPageData.totalPages) {
        return null;
      }

      return `${url}?${appendDiscoverQueryString(
        {
          page: pageIndex + 1,
          shuffleSeed: randomizeOrder ? shuffleSeed : undefined,
        },
        extraParams
      )}`;
    },
    [extraParams, randomizeOrder, shouldLoad, shuffleSeed, url]
  );

  const { data, error, setSize, size } = useSWRInfinite<MixedResult>(getKey, {
    initialSize: 1,
    revalidateFirstPage: false,
    dedupingInterval: 30000,
    revalidateOnFocus: false,
  });

  const refreshRandomizedOrder = useCallback(() => {
    if (!randomizeOrder) {
      return;
    }

    setSize(1);
    setShuffleSeed(
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    );
  }, [randomizeOrder, setSize]);

  const titles = useMemo(() => {
    const filteredTitles: SliderTitle[] = [];
    const resultKeys = new Set<string>();

    for (const page of data ?? []) {
      for (const item of page.results) {
        const resultKey = getMediaResultKey(item);

        if (resultKeys.has(resultKey)) {
          continue;
        }

        resultKeys.add(resultKey);

        if (
          settings.currentSettings.hideAvailable &&
          'mediaInfo' in item &&
          item.mediaInfo &&
          (item.mediaInfo.status === MediaStatus.AVAILABLE ||
            item.mediaInfo.status === MediaStatus.PARTIALLY_AVAILABLE)
        ) {
          continue;
        }

        if (
          settings.currentSettings.hideBlocklisted &&
          'mediaInfo' in item &&
          item.mediaInfo?.status === MediaStatus.BLOCKLISTED
        ) {
          continue;
        }

        filteredTitles.push(item);
      }
    }

    return filteredTitles;
  }, [
    data,
    settings.currentSettings.hideAvailable,
    settings.currentSettings.hideBlocklisted,
  ]);
  const blocklistVisibility = hasPermission(
    [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
    { type: 'or' }
  );

  const renderableTitles = useMemo(
    () =>
      titles.filter((title) => {
        if (blocklistVisibility) {
          return true;
        }

        return (
          (title as TvResult | MovieResult | AlbumResult | BookResult).mediaInfo
            ?.status !== MediaStatus.BLOCKLISTED
        );
      }),
    [blocklistVisibility, titles]
  );
  const visibleTitles = useMemo(
    () => renderableTitles.slice(0, 20),
    [renderableTitles]
  );
  useWarmImageCache(visibleTitles, { enabled: shouldLoad, maxUrls: 20 });

  const shouldLoadMore =
    renderableTitles.length < 24 &&
    size < 5 &&
    (data?.[0]?.totalResults ?? 0) > size * 20;

  useEffect(() => {
    if (shouldLoadMore) {
      setSize((currentSize) => currentSize + 1);
    }
  }, [setSize, shouldLoadMore]);

  useEffect(() => {
    if (onNewTitles) {
      // We aren't reporting all titles. We just want to know if there are any titles
      // at all for our purposes.
      onNewTitles(renderableTitles.length);
    }
  }, [onNewTitles, renderableTitles.length]);

  const showMorePosters = useMemo(
    () =>
      renderableTitles
        .slice(20, 24)
        .map((title) =>
          title.mediaType !== 'person' && title.mediaType !== 'artist'
            ? title.posterPath
            : undefined
        ),
    [renderableTitles]
  );

  const finalTitles = useMemo(() => {
    const cardTitles = visibleTitles.map((title) => {
      switch (title.mediaType) {
        case 'movie':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
              image={title.posterPath}
              status={title.mediaInfo?.status}
              summary={title.overview}
              title={title.title}
              userScore={title.voteAverage}
              year={title.releaseDate}
              mediaType={title.mediaType}
              inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
              showText={visibility.movie === 'always'}
            />
          );
        case 'tv':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
              image={title.posterPath}
              status={title.mediaInfo?.status}
              summary={title.overview}
              title={title.name}
              userScore={title.voteAverage}
              year={title.firstAirDate}
              mediaType={title.mediaType}
              inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
              showText={visibility.tv === 'always'}
            />
          );
        case 'person':
          return (
            <PersonCard
              key={title.id}
              personId={title.id}
              name={title.name}
              profilePath={title.profilePath}
            />
          );
        case 'album':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
              image={title.posterPath}
              status={title.mediaInfo?.status}
              title={title.title}
              artist={title['artist-credit']?.[0]?.name}
              type={title['primary-type']}
              year={
                title.releaseDate ?? title['first-release-date']?.split('-')[0]
              }
              mediaType={title.mediaType}
              inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
              needsCoverArt={title.needsCoverArt}
              showText={visibility.album === 'always'}
            />
          );
        case 'book':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              image={title.posterPath}
              isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
              status={title.mediaInfo?.status}
              title={title.title}
              artist={title.author}
              year={title.firstPublishYear?.toString()}
              mediaType={title.mediaType}
              showText={visibility.book === 'always'}
            />
          );
        case 'artist':
          return (
            <TitleCard
              key={title.id}
              id={title.id}
              image={title.artistThumb ?? undefined}
              title={title.name}
              mediaType={title.mediaType}
            />
          );
      }
    });

    if (linkUrl && renderableTitles.length > 20) {
      cardTitles.push(
        <ShowMoreCard key="show-more" url={linkUrl} posters={showMorePosters} />
      );
    }

    return cardTitles;
  }, [
    linkUrl,
    renderableTitles.length,
    showMorePosters,
    visibleTitles,
    visibility.album,
    visibility.book,
    visibility.movie,
    visibility.tv,
  ]);

  const hasReachedEnd =
    !!data &&
    ((data[data.length - 1]?.results.length ?? 0) < 20 ||
      (data[data.length - 1]?.totalResults ?? 0) <= size * 20 ||
      size >= 5);

  if (hideWhenEmpty && data && hasReachedEnd && !renderableTitles.length) {
    return null;
  }

  return (
    <div ref={ref}>
      <div className="slider-header">
        {linkUrl ? (
          <Link href={linkUrl} className="slider-title min-w-0 pr-16">
            <span className="truncate">{title}</span>
            <ArrowRightCircleIcon />
          </Link>
        ) : (
          <div className="slider-title">
            <span>{title}</span>
          </div>
        )}
        {(['movie', 'tv', 'album', 'book'] as const).map((mediaType) =>
          visibleTitles.some((item) => item.mediaType === mediaType) ? (
            <CardTextVisibilityToggle key={mediaType} mediaType={mediaType} />
          ) : null
        )}
        {randomizeOrder && (
          <button
            type="button"
            onClick={refreshRandomizedOrder}
            className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-700 text-gray-300 transition hover:border-indigo-500 hover:bg-indigo-600/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label={`Refresh ${title}`}
            title={`Refresh ${title}`}
          >
            <ArrowPathIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      <Slider
        sliderKey={sliderKey}
        isLoading={!data && !error}
        isEmpty={!!data && hasReachedEnd && !renderableTitles.length}
        items={finalTitles}
      />
    </div>
  );
};

const isEditingSafe = () => typeof window === 'undefined';

export default MediaSlider;
