import CachedImage from '@app/components/Common/CachedImage';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Button from '@app/components/Common/Button';
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
  NoSymbolIcon,
} from '@heroicons/react/24/solid';
import { IssueStatus } from '@server/constants/issue';
import { MediaStatus, MediaType } from '@server/constants/media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
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
  subjects: 'Subjects',
  manage: 'Manage',
  reportissue: 'Report an Issue',
  openissues: 'Open Issues',
});

const BookDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showManager, setShowManager] = useState(router.query.manage === '1');
  const [isBlocklisting, setIsBlocklisting] = useState(false);

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
  const canShowRequest =
    canRequest &&
    (!data.mediaInfo?.status ||
      data.mediaInfo.status === MediaStatus.UNKNOWN ||
      data.mediaInfo.status === MediaStatus.DELETED);
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
  const openIssues =
    data.mediaInfo?.issues?.filter((issue) => issue.status === IssueStatus.OPEN) ??
    [];

  const blocklistBook = async () => {
    setIsBlocklisting(true);

    try {
      await axios.post('/api/v1/blocklist', {
        externalId: data.id,
        externalProvider: MediaIdentifierProvider.OPENLIBRARY,
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
        show={showRequestModal}
        type="book"
        onComplete={() => {
          setShowRequestModal(false);
          revalidate();
        }}
        onCancel={() => setShowRequestModal(false)}
      />
      <div className="relative z-10 mt-4 flex flex-col gap-6 lg:flex-row">
        <div className="w-full max-w-xs flex-shrink-0">
          <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-gray-800 ring-1 ring-gray-700">
            <CachedImage
              type="music"
              src={data.posterPath ?? '/images/seerr_poster_not_found_logo_top.png'}
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
                  mediaType="book"
                  externalId={data.id}
                  serviceUrl={data.mediaInfo.serviceUrl}
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
          {(canShowRequest || canReportIssue || canBlocklist || canManage) && (
            <div className="mt-6 flex flex-wrap gap-2">
              {canShowRequest && (
                <Button
                  buttonType="primary"
                  onClick={() => setShowRequestModal(true)}
                >
                  <ArrowDownTrayIcon />
                  <span>{intl.formatMessage(globalMessages.request)}</span>
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
                  className={isBlocklisting ? 'pointer-events-none opacity-50' : ''}
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
