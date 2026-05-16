import CachedImage from '@app/components/Common/CachedImage';
import type { ForwardRefRenderFunction, HTMLAttributes } from 'react';
import React, { useEffect, useState } from 'react';

interface ImageFaderProps extends HTMLAttributes<HTMLDivElement> {
  backgroundImages: string[];
  rotationSpeed?: number;
  isDarker?: boolean;
  forceOptimize?: boolean;
}

const DEFAULT_ROTATION_SPEED = 6000;

const ImageFader: ForwardRefRenderFunction<HTMLDivElement, ImageFaderProps> = (
  {
    backgroundImages,
    rotationSpeed = DEFAULT_ROTATION_SPEED,
    isDarker,
    forceOptimize,
    ...props
  },
  ref
) => {
  const [activeIndex, setIndex] = useState(0);
  const imageCount = backgroundImages.length;

  useEffect(() => {
    if (activeIndex >= imageCount) {
      setIndex(0);
    }
  }, [activeIndex, imageCount]);

  useEffect(() => {
    if (imageCount < 2) {
      return;
    }

    const interval = setInterval(
      () => setIndex((ai) => (ai + 1) % imageCount),
      rotationSpeed
    );

    return () => {
      clearInterval(interval);
    };
  }, [imageCount, rotationSpeed]);

  let gradient =
    'linear-gradient(180deg, rgba(45, 55, 72, 0.47) 0%, #1A202E 100%)';

  if (isDarker) {
    gradient =
      'linear-gradient(180deg, rgba(17, 24, 39, 0.47) 0%, rgba(17, 24, 39, 1) 100%)';
  }

  let overrides = {};

  if (forceOptimize) {
    overrides = {
      unoptimized: false,
    };
  }

  return (
    <div ref={ref}>
      {backgroundImages.map((imageUrl, i) => {
        if (
          imageCount > 0 &&
          i !== activeIndex &&
          i !== (activeIndex + 1) % imageCount
        ) {
          return null;
        }

        return (
          <div
            key={`banner-image-${i}`}
            className={`absolute-top-shift absolute inset-0 bg-cover bg-center transition-opacity duration-300 ease-in ${
              i === activeIndex ? 'opacity-100' : 'opacity-0'
            }`}
            {...props}
          >
            <CachedImage
              type="tmdb"
              className="absolute inset-0 h-full w-full"
              alt=""
              src={imageUrl}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
              priority={i === activeIndex}
              loading={i === activeIndex ? 'eager' : 'lazy'}
              {...overrides}
            />
            <div
              className="absolute inset-0"
              style={{ backgroundImage: gradient }}
            />
          </div>
        );
      })}
    </div>
  );
};

export default React.forwardRef<HTMLDivElement, ImageFaderProps>(ImageFader);
