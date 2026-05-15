import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Button from '@app/components/Common/Button';
import RequestModal from '@app/components/RequestModal';
import StatusBadge from '@app/components/StatusBadge';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon } from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import type { BookDetails as BookDetailsType } from '@server/models/Book';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.BookDetails', {
  book: 'Book',
  author: 'Author',
  firstPublished: 'First Published',
  subjects: 'Subjects',
});

const BookDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { hasPermission } = useUser();
  const [showRequestModal, setShowRequestModal] = useState(false);

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<BookDetailsType>(
    router.query.bookId ? `/api/v1/book/${router.query.bookId}` : null
  );

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

  return (
    <>
      <PageTitle title={data.title} />
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
          {canShowRequest && (
            <div className="mt-6">
              <Button
                buttonType="primary"
                onClick={() => setShowRequestModal(true)}
              >
                <ArrowDownTrayIcon />
                <span>{intl.formatMessage(globalMessages.request)}</span>
              </Button>
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
    </>
  );
};

export default BookDetails;
