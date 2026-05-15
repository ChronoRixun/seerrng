import ArtistCard from '@app/components/ArtistCard';
import PersonCard from '@app/components/PersonCard';
import TitleCard from '@app/components/TitleCard';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { Permission, useUser } from '@app/hooks/useUser';
import useVerticalScroll from '@app/hooks/useVerticalScroll';
import globalMessages from '@app/i18n/globalMessages';
import { MediaStatus } from '@server/constants/media';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';
import type {
  AlbumResult,
  ArtistResult,
  BookResult,
  CollectionResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useIntl } from 'react-intl';

type ListViewProps = {
  items?: (
    | TvResult
    | MovieResult
    | PersonResult
    | CollectionResult
    | ArtistResult
    | AlbumResult
    | BookResult
  )[];
  plexItems?: WatchlistItem[];
  isEmpty?: boolean;
  isLoading?: boolean;
  isReachingEnd?: boolean;
  onScrollBottom: () => void;
  mutateParent?: () => void;
};

const ListView = ({
  items,
  isEmpty,
  isLoading,
  onScrollBottom,
  isReachingEnd,
  plexItems,
  mutateParent,
}: ListViewProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  useVerticalScroll(onScrollBottom, !isLoading && !isEmpty && !isReachingEnd);

  const blocklistVisibility = hasPermission(
    [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
    { type: 'or' }
  );
  const isBookInProgress = (title: BookResult) =>
    (title.mediaInfo?.downloadStatus ?? []).length > 0 ||
    (title.mediaInfo?.audiobookDownloadStatus ?? []).length > 0;
  const canRequestMissingBookFormat = (title: BookResult) => {
    if (
      !title.mediaInfo ||
      title.mediaInfo.status === MediaStatus.BLOCKLISTED
    ) {
      return false;
    }

    const hasEbookServiceLink =
      title.mediaInfo.serviceId !== null &&
      title.mediaInfo.serviceId !== undefined &&
      title.mediaInfo.externalServiceId !== null &&
      title.mediaInfo.externalServiceId !== undefined;
    const hasAudiobookServiceLink =
      title.mediaInfo.audiobookServiceId !== null &&
      title.mediaInfo.audiobookServiceId !== undefined &&
      title.mediaInfo.audiobookExternalServiceId !== null &&
      title.mediaInfo.audiobookExternalServiceId !== undefined;

    return !hasEbookServiceLink || !hasAudiobookServiceLink;
  };

  return (
    <>
      {isEmpty && (
        <div className="mt-64 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(globalMessages.noresults)}
        </div>
      )}
      <ul className="cards-vertical">
        {plexItems?.map((title, index) => {
          return (
            <li key={`${title.ratingKey}-${index}`}>
              {title.mediaType === 'music' && title.mbId ? (
                <TitleCard
                  id={title.mbId}
                  title={title.title}
                  mediaType="album"
                  isAddedToWatchlist={true}
                  canExpand
                  mutateParent={mutateParent}
                />
              ) : title.mediaType === 'book' && title.externalId ? (
                <TitleCard
                  id={title.externalId}
                  title={title.title}
                  mediaType="book"
                  isAddedToWatchlist={true}
                  canExpand
                  mutateParent={mutateParent}
                />
              ) : title.tmdbId ? (
                <TmdbTitleCard
                  id={title.tmdbId}
                  tmdbId={title.tmdbId}
                  type={title.mediaType === 'tv' ? 'tv' : 'movie'}
                  isAddedToWatchlist={true}
                  canExpand
                  mutateParent={mutateParent}
                />
              ) : null}
            </li>
          );
        })}
        {items
          ?.filter((title) => {
            if (!blocklistVisibility)
              return (
                (title as TvResult | MovieResult | AlbumResult | BookResult)
                  .mediaInfo?.status !== MediaStatus.BLOCKLISTED
              );
            return title;
          })
          .map((title, index) => {
            let titleCard: React.ReactNode;

            switch (title.mediaType) {
              case 'movie':
                titleCard = (
                  <TitleCard
                    key={title.id}
                    id={title.id}
                    isAddedToWatchlist={
                      title.mediaInfo?.watchlists?.length ?? 0
                    }
                    image={title.posterPath}
                    status={title.mediaInfo?.status}
                    summary={title.overview}
                    title={title.title}
                    userScore={title.voteAverage}
                    year={title.releaseDate}
                    mediaType={title.mediaType}
                    inProgress={
                      (title.mediaInfo?.downloadStatus ?? []).length > 0
                    }
                    canExpand
                  />
                );
                break;
              case 'tv':
                titleCard = (
                  <TitleCard
                    key={title.id}
                    id={title.id}
                    isAddedToWatchlist={
                      title.mediaInfo?.watchlists?.length ?? 0
                    }
                    image={title.posterPath}
                    status={title.mediaInfo?.status}
                    summary={title.overview}
                    title={title.name}
                    userScore={title.voteAverage}
                    year={title.firstAirDate}
                    mediaType={title.mediaType}
                    inProgress={
                      (title.mediaInfo?.downloadStatus ?? []).length > 0
                    }
                    canExpand
                  />
                );
                break;
              case 'collection':
                titleCard = (
                  <TitleCard
                    id={title.id}
                    image={title.posterPath}
                    summary={title.overview}
                    title={title.title}
                    mediaType={title.mediaType}
                    canExpand
                  />
                );
                break;
              case 'person':
                titleCard = (
                  <PersonCard
                    personId={title.id}
                    name={title.name}
                    profilePath={title.profilePath}
                    canExpand
                  />
                );
                break;
              case 'album':
                titleCard = (
                  <TitleCard
                    key={title.id}
                    id={title.id}
                    isAddedToWatchlist={
                      title.mediaInfo?.watchlists?.length ?? 0
                    }
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
                    inProgress={
                      (title.mediaInfo?.downloadStatus ?? []).length > 0
                    }
                    needsCoverArt={title.needsCoverArt}
                    canExpand
                  />
                );
                break;
              case 'artist':
                titleCard = title.tmdbPersonId ? (
                  <PersonCard
                    key={title.id}
                    personId={title.tmdbPersonId}
                    name={title.name}
                    profilePath={title.artistThumb ?? undefined}
                    subName={title.disambiguation}
                    canExpand
                  />
                ) : (
                  <ArtistCard
                    key={title.id}
                    artistId={title.id}
                    name={title.name}
                    artistThumb={title.artistThumb}
                    subName={title.disambiguation}
                    canExpand
                  />
                );
                break;
              case 'book':
                titleCard = (
                  <TitleCard
                    key={title.id}
                    id={title.id}
                    image={title.posterPath}
                    isAddedToWatchlist={
                      title.mediaInfo?.watchlists?.length ?? 0
                    }
                    status={title.mediaInfo?.status}
                    title={title.title}
                    artist={title.author}
                    type="Book"
                    year={title.firstPublishYear?.toString()}
                    mediaType={title.mediaType}
                    inProgress={isBookInProgress(title)}
                    canRequestAdditionalFormat={canRequestMissingBookFormat(
                      title
                    )}
                    canExpand
                  />
                );
                break;
            }

            return <li key={`${title.id}-${index}`}>{titleCard}</li>;
          })}
        {isLoading &&
          !isReachingEnd &&
          [...Array(20)].map((_item, i) => (
            <li key={`placeholder-${i}`}>
              <TitleCard.Placeholder canExpand />
            </li>
          ))}
      </ul>
    </>
  );
};

export default ListView;
