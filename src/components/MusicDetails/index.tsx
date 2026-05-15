import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import RequestModal from '@app/components/RequestModal';
import StatusBadge from '@app/components/StatusBadge';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import type { MusicDetails as MusicDetailsType } from '@server/models/Music';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MusicDetails', {
  album: 'Album',
  artist: 'Artist',
  releasedate: 'Release Date',
  tracks: 'Tracks',
  noTracks: 'No tracks available.',
});

const MusicDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { hasPermission } = useUser();
  const [showRequestModal, setShowRequestModal] = useState(false);

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MusicDetailsType>(
    router.query.musicId ? `/api/v1/music/${router.query.musicId}` : null
  );

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

  return (
    <>
      <PageTitle title={data.title} />
      <RequestModal
        show={showRequestModal}
        type="music"
        mbId={data.id}
        onCancel={() => setShowRequestModal(false)}
        onComplete={() => {
          setShowRequestModal(false);
          revalidate();
        }}
      />
      <div className="relative z-10 mt-4 flex flex-col gap-6 lg:flex-row">
        <div className="w-full max-w-xs flex-shrink-0">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-gray-800 ring-1 ring-gray-700">
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
            <span className="rounded-full border border-emerald-500 bg-emerald-600/80 px-3 py-1 text-xs font-medium uppercase tracking-wider text-white">
              {intl.formatMessage(messages.album)}
            </span>
            {data.mediaInfo?.status && data.mediaInfo.status !== MediaStatus.UNKNOWN && (
              <StatusBadge status={data.mediaInfo.status} />
            )}
          </div>
          <h1 className="break-words text-3xl font-bold text-white lg:text-5xl">
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
          {canShowRequest && (
            <div className="mt-6 max-w-xs">
              <Button
                buttonType="primary"
                onClick={() => setShowRequestModal(true)}
              >
                <ArrowDownTrayIcon />
                <span>{intl.formatMessage(globalMessages.request)}</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-10">
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
