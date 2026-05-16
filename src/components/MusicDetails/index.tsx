import Spinner from '@app/assets/spinner.svg';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import ExternalMediaManageSlideOver from '@app/components/ExternalMediaManageSlideOver';
import IssueBlock from '@app/components/IssueBlock';
import IssueModal from '@app/components/IssueModal';
import RequestModal from '@app/components/RequestModal';
import StatusBadge from '@app/components/StatusBadge';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  CogIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MinusCircleIcon,
  NoSymbolIcon,
  StarIcon,
} from '@heroicons/react/24/outline';
import { IssueStatus } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { UserType } from '@server/constants/user';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { MusicDetails as MusicDetailsType } from '@server/models/Music';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MusicDetails', {
  album: 'Album',
  artist: 'Artist',
  releasedate: 'Release Date',
  identifiers: 'Identifiers',
  musicbrainz: 'MusicBrainz',
  tracks: 'Tracks',
  noTracks: 'No tracks available.',
  manage: 'Manage',
  reportissue: 'Report an Issue',
  openissues: 'Open Issues',
  watchlistSuccess: '<strong>{title}</strong> added to watchlist successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> Removed from watchlist successfully!',
  watchlistError: 'Something went wrong. Please try again.',
  removefromwatchlist: 'Remove From Watchlist',
  addtowatchlist: 'Add To Watchlist',
  viewrequest: 'View Request',
});

const MusicDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editRequest, setEditRequest] =
    useState<NonFunctionProperties<MediaRequest>>();
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showManager, setShowManager] = useState(router.query.manage === '1');
  const [isBlocklisting, setIsBlocklisting] = useState(false);
  const [isWatchlistUpdating, setIsWatchlistUpdating] = useState(false);
  const [toggleWatchlist, setToggleWatchlist] = useState(true);

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MusicDetailsType>(
    router.query.musicId ? `/api/v1/music/${router.query.musicId}` : null
  );

  useEffect(() => {
    setShowManager(router.query.manage === '1');
  }, [router.query.manage]);

  useEffect(() => {
    setToggleWatchlist(!data?.onUserWatchlist);
  }, [data?.onUserWatchlist]);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );
  const canShowRequest =
    canRequest &&
    (!data.mediaInfo?.status ||
      data.mediaInfo.status === MediaStatus.UNKNOWN ||
      data.mediaInfo.status === MediaStatus.DELETED);
  const activeMusicRequests =
    data.mediaInfo?.requests?.filter(
      (request) =>
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.COMPLETED
    ) ?? [];
  const activeMusicRequest =
    activeMusicRequests.find(
      (request) => request.requestedBy.id === user?.id
    ) ??
    (hasPermission(Permission.MANAGE_REQUESTS) &&
    activeMusicRequests.length === 1
      ? activeMusicRequests[0]
      : undefined);
  const canReportIssue =
    !!data.mediaInfo?.id &&
    data.mediaInfo.status === MediaStatus.AVAILABLE &&
    hasPermission([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
      type: 'or',
    });
  const canBlocklist =
    hasPermission(Permission.MANAGE_BLOCKLIST) &&
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED;
  const canManage =
    hasPermission(Permission.MANAGE_REQUESTS) &&
    data.mediaInfo &&
    data.mediaInfo.status !== MediaStatus.UNKNOWN;
  const canWatchlist =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    user?.userType !== UserType.PLEX;
  const openIssues =
    data.mediaInfo?.issues?.filter(
      (issue) => issue.status === IssueStatus.OPEN
    ) ?? [];

  const blocklistAlbum = async () => {
    setIsBlocklisting(true);

    try {
      await axios.post('/api/v1/blocklist', {
        externalId: data.mbId,
        externalProvider: 'musicbrainz',
        mediaType: MediaType.MUSIC,
        title: data.title,
      });

      addToast(
        <span>
          {intl.formatMessage(globalMessages.blocklistSuccess, {
            title: data.title,
            strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
      revalidate();
    } catch {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsBlocklisting(false);
    }
  };

  const addToWatchlist = async (): Promise<void> => {
    setIsWatchlistUpdating(true);

    try {
      const response = await axios.post('/api/v1/watchlist', {
        mbId: data.mbId,
        mediaType: MediaType.MUSIC,
        title: data.title,
      });

      if (response.data) {
        addToast(
          <span>
            {intl.formatMessage(messages.watchlistSuccess, {
              title: data.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }

      setToggleWatchlist(false);
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsWatchlistUpdating(false);
      revalidate();
    }
  };

  const removeFromWatchlist = async (): Promise<void> => {
    setIsWatchlistUpdating(true);

    try {
      await axios.delete(`/api/v1/watchlist/${data.mbId}?mediaType=music`);

      addToast(
        <span>
          {intl.formatMessage(messages.watchlistDeleted, {
            title: data.title,
            strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'info', autoDismiss: true }
      );
      setToggleWatchlist(true);
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsWatchlistUpdating(false);
      revalidate();
    }
  };

  return (
    <>
      <PageTitle title={data.title} />
      <ExternalMediaManageSlideOver
        data={data}
        mediaType={MediaType.MUSIC}
        onClose={() => {
          setShowManager(false);
          router.push({
            pathname: router.pathname,
            query: { musicId: router.query.musicId },
          });
        }}
        revalidate={() => revalidate()}
        show={showManager}
      />
      <IssueModal
        show={showIssueModal}
        mediaType="music"
        mediaId={data.mediaInfo?.id}
        title={data.title}
        backdrop={data.artistBackdrop}
        onCancel={() => setShowIssueModal(false)}
      />
      <RequestModal
        editRequest={editRequest}
        show={showRequestModal}
        type="music"
        mbId={data.id}
        onCancel={() => {
          setEditRequest(undefined);
          setShowRequestModal(false);
        }}
        onComplete={() => {
          setEditRequest(undefined);
          setShowRequestModal(false);
          revalidate();
        }}
      />
      <div className="relative z-10 mt-4 flex flex-col gap-6 lg:flex-row">
        <div className="w-full max-w-xs flex-shrink-0">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-gray-800 ring-1 ring-gray-700">
            <CachedImage
              type="music"
              src={
                data.posterPath ?? '/images/seerr_poster_not_found_logo_top.png'
              }
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
            />
          </div>
        </div>
        <div className="min-w-0 flex-1 text-gray-300">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-500 bg-emerald-600/80 px-3 py-1 text-xs font-medium uppercase tracking-wider text-white">
              {intl.formatMessage(messages.album)}
            </span>
            {data.mediaInfo?.status &&
              data.mediaInfo.status !== MediaStatus.UNKNOWN && (
                <StatusBadge
                  status={data.mediaInfo.status}
                  downloadItem={data.mediaInfo.downloadStatus}
                  inProgress={(data.mediaInfo.downloadStatus ?? []).length > 0}
                  mediaType="music"
                  mbId={data.mbId}
                  serviceUrl={data.mediaInfo.serviceUrl}
                />
              )}
          </div>
          <h1
            className="break-words text-3xl font-bold text-white lg:text-5xl"
            data-testid="media-title"
          >
            {data.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Link
              href={`/artist/${data.artist.id}`}
              className="font-medium text-gray-100 transition hover:text-white"
            >
              {data.artist.name}
            </Link>
            {data.releaseDate && (
              <span>
                {intl.formatMessage(messages.releasedate)}:{' '}
                {data.releaseDate.slice(0, 4)}
              </span>
            )}
            {data.type && <span>{data.type}</span>}
          </div>
          {(canWatchlist ||
            canShowRequest ||
            canReportIssue ||
            canBlocklist ||
            canManage) && (
            <div className="mt-6 flex max-w-xs flex-wrap gap-2">
              {canWatchlist && (
                <>
                  {toggleWatchlist ? (
                    <Tooltip
                      content={intl.formatMessage(messages.addtowatchlist)}
                    >
                      <Button buttonType="ghost" onClick={addToWatchlist}>
                        {isWatchlistUpdating ? (
                          <Spinner />
                        ) : (
                          <StarIcon className="text-amber-300" />
                        )}
                      </Button>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      content={intl.formatMessage(messages.removefromwatchlist)}
                    >
                      <Button onClick={removeFromWatchlist}>
                        {isWatchlistUpdating ? (
                          <Spinner />
                        ) : (
                          <MinusCircleIcon />
                        )}
                      </Button>
                    </Tooltip>
                  )}
                </>
              )}
              {canShowRequest && (
                <Button
                  buttonType="primary"
                  onClick={() => {
                    setEditRequest(undefined);
                    setShowRequestModal(true);
                  }}
                >
                  <ArrowDownTrayIcon />
                  <span>{intl.formatMessage(globalMessages.request)}</span>
                </Button>
              )}
              {activeMusicRequest && (
                <Button
                  buttonType="default"
                  onClick={() => {
                    setEditRequest(activeMusicRequest);
                    setShowRequestModal(true);
                  }}
                >
                  <InformationCircleIcon />
                  <span>{intl.formatMessage(messages.viewrequest)}</span>
                </Button>
              )}
              {canManage && (
                <Button buttonType="ghost" onClick={() => setShowManager(true)}>
                  <CogIcon />
                  <span>{intl.formatMessage(messages.manage)}</span>
                </Button>
              )}
              {canReportIssue && (
                <Button
                  buttonType="default"
                  onClick={() => setShowIssueModal(true)}
                >
                  <ExclamationTriangleIcon />
                  <span>{intl.formatMessage(messages.reportissue)}</span>
                </Button>
              )}
              {canBlocklist && (
                <ConfirmButton
                  onClick={blocklistAlbum}
                  confirmText={intl.formatMessage(globalMessages.areyousure)}
                  className={
                    isBlocklisting ? 'pointer-events-none opacity-50' : ''
                  }
                >
                  <NoSymbolIcon />
                  <span>{intl.formatMessage(globalMessages.blocklist)}</span>
                </ConfirmButton>
              )}
            </div>
          )}
          <div className="media-facts mt-6 max-w-4xl">
            <div className="media-fact">
              <span>{intl.formatMessage(messages.artist)}</span>
              <span className="media-fact-value">
                <Link href={`/artist/${data.artist.id}`}>
                  {data.artist.name}
                </Link>
              </span>
            </div>
            {data.releaseDate && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.releasedate)}</span>
                <span className="media-fact-value">{data.releaseDate}</span>
              </div>
            )}
            {data.type && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.album)}</span>
                <span className="media-fact-value">{data.type}</span>
              </div>
            )}
            <div className="media-fact">
              <span>{intl.formatMessage(messages.identifiers)}</span>
              <span className="media-fact-value">
                <a
                  href={`https://musicbrainz.org/release-group/${data.mbId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {intl.formatMessage(messages.musicbrainz)}
                </a>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10">
        {hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
          type: 'or',
        }) &&
          openIssues.length > 0 && (
            <div className="mb-10">
              <h2 className="mb-4 text-2xl font-bold text-white">
                {intl.formatMessage(messages.openissues)}
              </h2>
              <div className="overflow-hidden rounded-lg ring-1 ring-gray-800">
                <ul>
                  {openIssues.map((issue) => (
                    <li
                      key={`music-issue-${issue.id}`}
                      className="border-b border-gray-800 last:border-b-0"
                    >
                      <IssueBlock issue={issue} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        <h2 className="mb-4 text-2xl font-bold text-white">
          {intl.formatMessage(messages.tracks)}
        </h2>
        {data.tracks.length ? (
          <ol className="divide-y divide-gray-800 overflow-hidden rounded-lg ring-1 ring-gray-800">
            {data.tracks.map((track) => (
              <li
                key={`${track.position}-${track.recordingMbid}`}
                className="flex items-center gap-4 bg-gray-900/40 px-4 py-3"
              >
                <span className="w-8 text-right text-sm text-gray-500">
                  {track.position}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-100">
                  {track.name}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-gray-400">
            {intl.formatMessage(messages.noTracks)}
          </div>
        )}
      </div>
    </>
  );
};

export default MusicDetails;
