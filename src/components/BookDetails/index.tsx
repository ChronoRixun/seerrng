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
} from '@heroicons/react/24/solid';
import { IssueStatus } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { UserType } from '@server/constants/user';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { BookDetails as BookDetailsType } from '@server/models/Book';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.BookDetails', {
  book: 'Book',
  author: 'Author',
  firstPublished: 'First Published',
  identifiers: 'Identifiers',
  openLibrary: 'Open Library',
  isbnCandidates: 'ISBN Candidates',
  subjects: 'Subjects',
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

const BookDetails = () => {
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
  } = useSWR<BookDetailsType>(
    router.query.bookId ? `/api/v1/book/${router.query.bookId}` : null
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
    [Permission.REQUEST, Permission.REQUEST_BOOK],
    { type: 'or' }
  );
  const hasEbookServiceLink =
    data.mediaInfo?.serviceId !== null &&
    data.mediaInfo?.serviceId !== undefined &&
    data.mediaInfo.externalServiceId !== null &&
    data.mediaInfo.externalServiceId !== undefined;
  const hasAudiobookServiceLink =
    data.mediaInfo?.audiobookServiceId !== null &&
    data.mediaInfo?.audiobookServiceId !== undefined &&
    data.mediaInfo.audiobookExternalServiceId !== null &&
    data.mediaInfo.audiobookExternalServiceId !== undefined;
  const activeBookRequests =
    data.mediaInfo?.requests?.filter(
      (request) =>
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.COMPLETED
    ) ?? [];
  const hasActiveEbookRequest = activeBookRequests.some(
    (request) =>
      (request.bookFormat ?? 'ebook') === 'ebook' ||
      request.bookFormat === 'both'
  );
  const hasActiveAudiobookRequest = activeBookRequests.some(
    (request) =>
      request.bookFormat === 'audiobook' || request.bookFormat === 'both'
  );
  const activeBookRequest =
    activeBookRequests.find((request) => request.requestedBy.id === user?.id) ??
    (hasPermission(Permission.MANAGE_REQUESTS) &&
    activeBookRequests.length === 1
      ? activeBookRequests[0]
      : undefined);
  const hasMissingBookFormat =
    !!data.mediaInfo &&
    data.mediaInfo.status !== MediaStatus.BLOCKLISTED &&
    (!(hasEbookServiceLink || hasActiveEbookRequest) ||
      !(hasAudiobookServiceLink || hasActiveAudiobookRequest));
  const bookDownloadStatus = [
    ...(data.mediaInfo?.downloadStatus ?? []),
    ...(data.mediaInfo?.audiobookDownloadStatus ?? []),
  ];
  const canShowRequest =
    canRequest &&
    (!data.mediaInfo?.status ||
      data.mediaInfo.status === MediaStatus.UNKNOWN ||
      data.mediaInfo.status === MediaStatus.DELETED ||
      hasMissingBookFormat);
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

  const blocklistBook = async () => {
    setIsBlocklisting(true);

    try {
      await axios.post('/api/v1/blocklist', {
        externalId: data.id,
        externalProvider: 'openlibrary',
        mediaType: MediaType.BOOK,
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
        externalId: data.id,
        mediaType: MediaType.BOOK,
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
      await axios.delete(`/api/v1/watchlist/${data.id}?mediaType=book`);

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
        mediaType={MediaType.BOOK}
        onClose={() => {
          setShowManager(false);
          router.push({
            pathname: router.pathname,
            query: { bookId: router.query.bookId },
          });
        }}
        revalidate={() => revalidate()}
        show={showManager}
      />
      <IssueModal
        show={showIssueModal}
        mediaType="book"
        mediaId={data.mediaInfo?.id}
        title={data.title}
        backdrop={data.posterPath}
        onCancel={() => setShowIssueModal(false)}
      />
      <RequestModal
        bookId={data.id}
        editRequest={editRequest}
        show={showRequestModal}
        type="book"
        onComplete={() => {
          setEditRequest(undefined);
          setShowRequestModal(false);
          revalidate();
        }}
        onCancel={() => {
          setEditRequest(undefined);
          setShowRequestModal(false);
        }}
      />
      <div className="relative z-10 mt-4 flex flex-col gap-6 lg:flex-row">
        <div className="w-full max-w-xs flex-shrink-0">
          <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-gray-800 ring-1 ring-gray-700">
            <CachedImage
              type="book"
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
            <span className="rounded-full border border-amber-500 bg-amber-600/80 px-3 py-1 text-xs font-medium uppercase tracking-wider text-white">
              {intl.formatMessage(messages.book)}
            </span>
            {data.mediaInfo?.status &&
              data.mediaInfo.status !== MediaStatus.UNKNOWN && (
                <StatusBadge
                  status={data.mediaInfo.status}
                  downloadItem={bookDownloadStatus}
                  inProgress={bookDownloadStatus.length > 0}
                  mediaType="book"
                  externalId={data.id}
                  serviceUrl={
                    data.mediaInfo.serviceUrl ??
                    data.mediaInfo.audiobookServiceUrl
                  }
                />
              )}
          </div>
          <h1 className="break-words text-3xl font-bold text-white lg:text-5xl">
            {data.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {data.author && (
              <span>
                {intl.formatMessage(messages.author)}: {data.author}
              </span>
            )}
            {data.firstPublishYear && (
              <span>
                {intl.formatMessage(messages.firstPublished)}:{' '}
                {data.firstPublishYear}
              </span>
            )}
          </div>
          {data.description && (
            <div className="mt-6 max-w-4xl whitespace-pre-line text-sm leading-6">
              {data.description}
            </div>
          )}
          <div className="mt-6 grid max-w-4xl grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-gray-800/70 p-3 ring-1 ring-gray-700">
              <div className="mb-2 font-semibold text-white">
                {intl.formatMessage(messages.identifiers)}
              </div>
              <div className="space-y-1 text-gray-300">
                <div>
                  {intl.formatMessage(messages.openLibrary)}: {data.id}
                </div>
                {data.isbn13 && <div>ISBN: {data.isbn13}</div>}
                {data.editionId && <div>Edition: {data.editionId}</div>}
              </div>
            </div>
            {!!data.isbnCandidates?.length && (
              <div className="rounded-lg bg-gray-800/70 p-3 ring-1 ring-gray-700">
                <div className="mb-2 font-semibold text-white">
                  {intl.formatMessage(messages.isbnCandidates)}
                </div>
                <div className="space-y-1 text-gray-300">
                  {data.isbnCandidates.slice(0, 5).map((candidate) => (
                    <div
                      key={`${candidate.editionId ?? candidate.isbn}-${candidate.isbn}`}
                      className="truncate"
                      title={[candidate.isbn, candidate.title, candidate.format]
                        .filter(Boolean)
                        .join(' - ')}
                    >
                      {[candidate.isbn, candidate.title, candidate.format]
                        .filter(Boolean)
                        .join(' - ')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {(canWatchlist ||
            canShowRequest ||
            canReportIssue ||
            canBlocklist ||
            canManage) && (
            <div className="mt-6 flex flex-wrap gap-2">
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
              {activeBookRequest && (
                <Button
                  buttonType="default"
                  onClick={() => {
                    setEditRequest(activeBookRequest);
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
                  onClick={blocklistBook}
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
          {!!data.subjects?.length && (
            <div className="mt-6">
              <h2 className="mb-2 text-lg font-semibold text-white">
                {intl.formatMessage(messages.subjects)}
              </h2>
              <div className="flex flex-wrap gap-2">
                {data.subjects.map((subject) => (
                  <span
                    key={subject}
                    className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-200 ring-1 ring-gray-700"
                  >
                    {subject}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
        type: 'or',
      }) &&
        openIssues.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-4 text-2xl font-bold text-white">
              {intl.formatMessage(messages.openissues)}
            </h2>
            <div className="overflow-hidden rounded-lg ring-1 ring-gray-800">
              <ul>
                {openIssues.map((issue) => (
                  <li
                    key={`book-issue-${issue.id}`}
                    className="border-b border-gray-800 last:border-b-0"
                  >
                    <IssueBlock issue={issue} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
    </>
  );
};

export default BookDetails;
