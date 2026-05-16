import ShowMoreCard from '@app/components/MediaSlider/ShowMoreCard';
import PersonCard from '@app/components/PersonCard';
import Slider from '@app/components/Slider';
import TitleCard from '@app/components/TitleCard';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import { Permission } from '@server/lib/permissions';
import type {
  AlbumResult,
  BookResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { useInView } from 'react-intersection-observer';
import useSWRInfinite from 'swr/infinite';

interface MixedResult {
  page: number;
  totalResults: number;
  totalPages: number;
  results: (TvResult | MovieResult | PersonResult | AlbumResult | BookResult)[];
}

interface MediaSliderProps {
  title: string;
  url: string;
  linkUrl?: string;
  sliderKey: string;
  hideWhenEmpty?: boolean;
  extraParams?: string;
  onNewTitles?: (titleCount: number) => void;
}

const MediaSlider = ({
  title,
  url,
  linkUrl,
  extraParams,
  sliderKey,
  hideWhenEmpty = false,
  onNewTitles,
}: MediaSliderProps) => {
  const settings = useSettings();
  const { hasPermission } = useUser();
  const { ref, inView } = useInView({
    rootMargin: '450px 0px',
    triggerOnce: true,
  });
  const shouldLoad = isEditingSafe() || inView;
  const { data, error, setSize, size } = useSWRInfinite<MixedResult>(
    (pageIndex: number, previousPageData: MixedResult | null) => {
      if (!shouldLoad) {
        return null;
      }

      if (previousPageData && pageIndex + 1 > previousPageData.totalPages) {
        return null;
      }

      return `${url}?page=${pageIndex + 1}${
        extraParams ? `&${extraParams}` : ''
      }`;
    },
    {
      initialSize: 1,
      revalidateFirstPage: false,
      dedupingInterval: 30000,
      revalidateOnFocus: false,
    }
  );

  const titles = useMemo(() => {
    let filteredTitles: (
      | MovieResult
      | TvResult
      | PersonResult
      | AlbumResult
      | BookResult
    )[] = [];

    for (const page of data ?? []) {
      filteredTitles.push(...page.results);
    }

    if (settings.currentSettings.hideAvailable) {
      filteredTitles = filteredTitles.filter(
        (i) =>
          !('mediaInfo' in i) ||
          !i.mediaInfo ||
          (i.mediaInfo.status !== MediaStatus.AVAILABLE &&
            i.mediaInfo.status !== MediaStatus.PARTIALLY_AVAILABLE)
      );
    }

    if (settings.currentSettings.hideBlocklisted) {
      filteredTitles = filteredTitles.filter(
        (i) =>
          !('mediaInfo' in i) ||
          !i.mediaInfo ||
          i.mediaInfo.status !== MediaStatus.BLOCKLISTED
      );
    }

    return filteredTitles;
  }, [
    data,
    settings.currentSettings.hideAvailable,
    settings.currentSettings.hideBlocklisted,
  ]);

  useEffect(() => {
    if (
      titles.length < 24 &&
      size < 5 &&
      (data?.[0]?.totalResults ?? 0) > size * 20
    ) {
      setSize(size + 1);
    }

    if (onNewTitles) {
      // We aren't reporting all titles. We just want to know if there are any titles
      // at all for our purposes.
      onNewTitles(titles.length);
    }
  }, [titles, setSize, size, data, onNewTitles]);

  if (hideWhenEmpty && data && (data[0]?.results ?? []).length === 0) {
    return null;
  }

  const blocklistVisibility = hasPermission(
    [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
    { type: 'or' }
  );

  const finalTitles = useMemo(() => {
    const cardTitles = titles
      .slice(0, 20)
      .filter((title) => {
        if (!blocklistVisibility)
          return (
            (title as TvResult | MovieResult | AlbumResult | BookResult)
              .mediaInfo?.status !== MediaStatus.BLOCKLISTED
          );
        return title;
      })
      .map((title) => {
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
              />
            );
          case 'person':
            return (
              <PersonCard
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
                  title.releaseDate ??
                  title['first-release-date']?.split('-')[0]
                }
                mediaType={title.mediaType}
                inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
                needsCoverArt={title.needsCoverArt}
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
              />
            );
        }
      });

    if (linkUrl && titles.length > 20) {
      cardTitles.push(
        <ShowMoreCard
          url={linkUrl}
          posters={titles
            .slice(20, 24)
            .map((title) =>
              title.mediaType !== 'person' ? title.posterPath : undefined
            )}
        />
      );
    }

    return cardTitles;
  }, [blocklistVisibility, linkUrl, titles]);

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
      </div>
      <Slider
        sliderKey={sliderKey}
        isLoading={!data && !error}
        isEmpty={false}
        items={finalTitles}
      />
    </div>
  );
};

const isEditingSafe = () => typeof window === 'undefined';

export default MediaSlider;
