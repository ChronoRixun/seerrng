import { Transition } from '@headlessui/react';
import type { MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import dynamic from 'next/dynamic';

const BookRequestModal = dynamic(
  () => import('@app/components/RequestModal/BookRequestModal'),
  { ssr: false }
);
const CollectionRequestModal = dynamic(
  () => import('@app/components/RequestModal/CollectionRequestModal'),
  { ssr: false }
);
const MovieRequestModal = dynamic(
  () => import('@app/components/RequestModal/MovieRequestModal'),
  { ssr: false }
);
const MusicRequestModal = dynamic(
  () => import('@app/components/RequestModal/MusicRequestModal'),
  { ssr: false }
);
const TvRequestModal = dynamic(
  () => import('@app/components/RequestModal/TvRequestModal'),
  { ssr: false }
);

interface RequestModalProps {
  show: boolean;
  type: 'movie' | 'tv' | 'collection' | 'music' | 'book';
  tmdbId?: number;
  mbId?: string;
  bookId?: string;
  is4k?: boolean;
  editRequest?: NonFunctionProperties<MediaRequest>;
  onComplete?: (newStatus: MediaStatus) => void;
  onCancel?: () => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const RequestModal = ({
  type,
  show,
  tmdbId,
  mbId,
  bookId,
  is4k,
  editRequest,
  onComplete,
  onUpdating,
  onCancel,
}: RequestModalProps) => {
  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      show={show}
    >
      {type === 'music' && mbId ? (
        <MusicRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          mbId={mbId}
          onUpdating={onUpdating}
          editRequest={editRequest}
        />
      ) : type === 'book' && bookId ? (
        <BookRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          bookId={bookId}
          onUpdating={onUpdating}
          editRequest={editRequest}
        />
      ) : type === 'movie' && tmdbId ? (
        <MovieRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          tmdbId={tmdbId}
          onUpdating={onUpdating}
          is4k={is4k}
          editRequest={editRequest}
        />
      ) : type === 'tv' && tmdbId ? (
        <TvRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          tmdbId={tmdbId}
          onUpdating={onUpdating}
          is4k={is4k}
          editRequest={editRequest}
        />
      ) : tmdbId ? (
        <CollectionRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          tmdbId={tmdbId}
          onUpdating={onUpdating}
          is4k={is4k}
        />
      ) : null}
    </Transition>
  );
};

export default RequestModal;
