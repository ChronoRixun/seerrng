import useSettings from '@app/hooks/useSettings';
import axios from 'axios';
import { useEffect, useMemo } from 'react';

type ImageWarmableResult = {
  mediaType?: string;
  posterPath?: string | null;
  remotePoster?: string | null;
  backdropPath?: string | null;
  profilePath?: string | null;
  artistThumb?: string | null;
  artistBackdrop?: string | null;
};

const getTmdbImageUrl = (path: string, size: string): string =>
  `https://image.tmdb.org/t/p/${size}${path}`;

const normalizeExternalImageUrl = (path?: string | null): string | null => {
  if (!path) {
    return null;
  }

  if (path.startsWith('http')) {
    return path;
  }

  return null;
};

const getImageUrls = (item: ImageWarmableResult): string[] => {
  const urls: (string | null)[] = [];

  if (
    item.posterPath &&
    ['movie', 'tv', 'person', 'collection'].includes(item.mediaType ?? '')
  ) {
    urls.push(getTmdbImageUrl(item.posterPath, 'w300_and_h450_face'));
  } else {
    urls.push(normalizeExternalImageUrl(item.posterPath));
  }

  urls.push(normalizeExternalImageUrl(item.remotePoster));

  if (
    item.backdropPath &&
    ['movie', 'tv', 'collection'].includes(item.mediaType ?? '')
  ) {
    urls.push(getTmdbImageUrl(item.backdropPath, 'w1920_and_h800_multi_faces'));
  }

  if (item.profilePath) {
    urls.push(
      item.profilePath.startsWith('/')
        ? getTmdbImageUrl(item.profilePath, 'w600_and_h900_bestv2')
        : normalizeExternalImageUrl(item.profilePath)
    );
  }

  urls.push(
    normalizeExternalImageUrl(item.artistThumb),
    normalizeExternalImageUrl(item.artistBackdrop)
  );

  return urls.filter((url): url is string => !!url);
};

const useWarmImageCache = (
  items?: ImageWarmableResult[],
  options: { enabled?: boolean; maxUrls?: number } = {}
) => {
  const { currentSettings } = useSettings();
  const { enabled = true, maxUrls } = options;
  const imageUrls = useMemo(
    () => [...new Set((items ?? []).flatMap(getImageUrls))].slice(0, maxUrls),
    [items, maxUrls]
  );

  useEffect(() => {
    if (
      !enabled ||
      !currentSettings.cacheImages ||
      imageUrls.length === 0 ||
      document.visibilityState === 'hidden'
    ) {
      return;
    }

    const warm = () => {
      axios.post('/imageproxy/warm', { urls: imageUrls }).catch(() => {
        // Cache warming is opportunistic and should never affect the UI.
      });
    };

    if ('requestIdleCallback' in window) {
      const idleCallbackId = window.requestIdleCallback(warm, {
        timeout: 3000,
      });

      return () => window.cancelIdleCallback(idleCallbackId);
    }

    const timeoutId = globalThis.setTimeout(warm, 250);

    return () => globalThis.clearTimeout(timeoutId);
  }, [currentSettings.cacheImages, enabled, imageUrls]);
};

export default useWarmImageCache;
