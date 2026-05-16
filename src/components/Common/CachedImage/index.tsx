import useSettings from '@app/hooks/useSettings';
import type { ImageLoader, ImageProps } from 'next/image';
import Image from 'next/image';

const imageLoader: ImageLoader = ({ src }) => src;

export type CachedImageProps = ImageProps & {
  src: string;
  type: 'tmdb' | 'avatar' | 'tvdb' | 'music' | 'book';
};

/**
 * The CachedImage component should be used wherever
 * we want to offer the option to locally cache images.
 **/
const CachedImage = ({
  src,
  type,
  decoding = 'async',
  loading,
  priority,
  ...props
}: CachedImageProps) => {
  const { currentSettings } = useSettings();

  let imageUrl: string;

  if (type === 'tmdb') {
    // tmdb stuff
    imageUrl =
      currentSettings.cacheImages && !src.startsWith('/')
        ? src.replace(/^https:\/\/image\.tmdb\.org\//, '/imageproxy/tmdb/')
        : src;
  } else if (type === 'tvdb') {
    imageUrl =
      currentSettings.cacheImages && !src.startsWith('/')
        ? src.replace(
            /^https:\/\/artworks\.thetvdb\.com\//,
            '/imageproxy/tvdb/'
          )
        : src;
  } else if (type === 'avatar') {
    // jellyfin avatar (if any)
    imageUrl = src;
  } else if (type === 'music' || type === 'book') {
    imageUrl = src;
  } else {
    return null;
  }

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
};

export default CachedImage;
