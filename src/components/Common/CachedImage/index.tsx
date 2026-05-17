import useSettings from '@app/hooks/useSettings';
import type { CacheableImageType } from '@app/utils/imageCache';
import { getImageCacheUrl } from '@app/utils/imageCache';
import type { ImageLoader, ImageProps } from 'next/image';
import Image from 'next/image';
import { memo, useMemo } from 'react';

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
    ...props
  }: CachedImageProps) => {
    const { currentSettings } = useSettings();

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
        {...props}
      />
    );
  }
);

CachedImage.displayName = 'CachedImage';

export default CachedImage;
