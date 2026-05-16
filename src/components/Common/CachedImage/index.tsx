import useSettings from '@app/hooks/useSettings';
import type { ImageLoader, ImageProps } from 'next/image';
import Image from 'next/image';
import { memo, useMemo } from 'react';

const imageLoader: ImageLoader = ({ src }) => src;

export type CachedImageProps = ImageProps & {
  src: string;
  type: 'tmdb' | 'avatar' | 'tvdb' | 'music' | 'book';
};

/**
 * The CachedImage component should be used wherever
 * we want to offer the option to locally cache images.
 **/
const proxiedImagePrefixes = {
  tmdb: {
    source: /^https:\/\/image\.tmdb\.org\//,
    target: '/imageproxy/tmdb/',
  },
  tvdb: {
    source: /^https:\/\/artworks\.thetvdb\.com\//,
    target: '/imageproxy/tvdb/',
  },
  musicCoverArtArchive: {
    source: /^https:\/\/coverartarchive\.org\//,
    target: '/imageproxy/coverartarchive/',
  },
  musicArchiveOrg: {
    source: /^https:\/\/archive\.org\//,
    target: '/imageproxy/archiveorg/',
  },
  book: {
    source: /^https:\/\/covers\.openlibrary\.org\//,
    target: '/imageproxy/openlibrarycovers/',
  },
};

const CachedImage = memo(
  ({
    src,
    type,
    decoding = 'async',
    loading,
    priority,
    ...props
  }: CachedImageProps) => {
    const { currentSettings } = useSettings();

    const imageUrl = useMemo(() => {
      if (!currentSettings.cacheImages || src.startsWith('/')) {
        return src;
      }

      if (type === 'tmdb') {
        return src.replace(
          proxiedImagePrefixes.tmdb.source,
          proxiedImagePrefixes.tmdb.target
        );
      }

      if (type === 'tvdb') {
        return src.replace(
          proxiedImagePrefixes.tvdb.source,
          proxiedImagePrefixes.tvdb.target
        );
      }

      if (type === 'music') {
        if (src.startsWith('https://coverartarchive.org/')) {
          return src.replace(
            proxiedImagePrefixes.musicCoverArtArchive.source,
            proxiedImagePrefixes.musicCoverArtArchive.target
          );
        }

        if (src.startsWith('https://archive.org/')) {
          return src.replace(
            proxiedImagePrefixes.musicArchiveOrg.source,
            proxiedImagePrefixes.musicArchiveOrg.target
          );
        }
      }

      if (type === 'book') {
        return src.replace(
          proxiedImagePrefixes.book.source,
          proxiedImagePrefixes.book.target
        );
      }

      return src;
    }, [currentSettings.cacheImages, src, type]);

    return (
      <Image
        unoptimized
        loader={imageLoader}
        src={imageUrl}
        decoding={decoding}
        loading={priority ? undefined : (loading ?? 'lazy')}
        priority={priority}
        {...props}
      />
    );
  }
);

CachedImage.displayName = 'CachedImage';

export default CachedImage;
