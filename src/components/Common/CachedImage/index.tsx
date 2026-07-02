import useSettings from '@app/hooks/useSettings';
import type { CacheableImageType } from '@app/utils/imageCache';
import { getImageCacheUrl } from '@app/utils/imageCache';
import type { ImageLoader, ImageProps } from 'next/image';
import Image from 'next/image';
import { memo, useMemo, useState } from 'react';

const imageLoader: ImageLoader = ({ src }) => src;

export type CachedImageProps = ImageProps & {
  src: string;
  type: CacheableImageType;
};

/**
 * The CachedImage component should be used wherever
 * we want to offer the option to locally cache images.
 **/
const CachedImage = memo(
  ({
    src,
    type,
    decoding = 'async',
    loading,
    priority,
    className,
    onLoad,
    onError,
    ...props
  }: CachedImageProps) => {
    const { currentSettings } = useSettings();
    const [isLoaded, setIsLoaded] = useState(false);

    const imageUrl = useMemo(
      () =>
        getImageCacheUrl({
          cacheImages: currentSettings.cacheImages,
          src,
          type,
        }),
      [currentSettings.cacheImages, src, type]
    );

    return (
      <Image
        unoptimized
        loader={imageLoader}
        src={imageUrl}
        decoding={decoding}
        loading={priority ? undefined : (loading ?? 'lazy')}
        priority={priority}
        className={`${
          className ?? ''
        } transition-opacity duration-300 ease-out ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={(e) => {
          setIsLoaded(true);
          onLoad?.(e);
        }}
        onError={(e) => {
          // Reveal the broken/alt state instead of leaving an invisible slot.
          setIsLoaded(true);
          onError?.(e);
        }}
        {...props}
      />
    );
  }
);

CachedImage.displayName = 'CachedImage';

export default CachedImage;
