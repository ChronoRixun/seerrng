export type CacheableImageType = 'tmdb' | 'avatar' | 'tvdb' | 'music' | 'book';

const PROXIED_IMAGE_PREFIXES = {
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

export const isRemoteAvatarCacheUrlAllowed = (src: string): boolean => {
  try {
    const avatarUrl = new URL(src);
    const hostname = avatarUrl.hostname.toLowerCase();

    return (
      avatarUrl.protocol === 'https:' &&
      !avatarUrl.username &&
      !avatarUrl.password &&
      (hostname === 'gravatar.com' ||
        hostname === 'secure.gravatar.com' ||
        hostname === 'www.gravatar.com' ||
        hostname.endsWith('.gravatar.com') ||
        hostname.endsWith('.plex.tv'))
    );
  } catch {
    return false;
  }
};

export const getImageCacheUrl = ({
  cacheImages,
  src,
  type,
}: {
  cacheImages: boolean;
  src: string;
  type: CacheableImageType;
}): string => {
  if (!cacheImages || src.startsWith('/')) {
    return src;
  }

  if (type === 'tmdb') {
    return src.replace(
      PROXIED_IMAGE_PREFIXES.tmdb.source,
      PROXIED_IMAGE_PREFIXES.tmdb.target
    );
  }

  if (type === 'tvdb') {
    return src.replace(
      PROXIED_IMAGE_PREFIXES.tvdb.source,
      PROXIED_IMAGE_PREFIXES.tvdb.target
    );
  }

  if (type === 'music') {
    if (src.startsWith('https://coverartarchive.org/')) {
      return src.replace(
        PROXIED_IMAGE_PREFIXES.musicCoverArtArchive.source,
        PROXIED_IMAGE_PREFIXES.musicCoverArtArchive.target
      );
    }

    if (src.startsWith('https://archive.org/')) {
      return src.replace(
        PROXIED_IMAGE_PREFIXES.musicArchiveOrg.source,
        PROXIED_IMAGE_PREFIXES.musicArchiveOrg.target
      );
    }
  }

  if (type === 'book') {
    return src.replace(
      PROXIED_IMAGE_PREFIXES.book.source,
      PROXIED_IMAGE_PREFIXES.book.target
    );
  }

  if (type === 'avatar' && isRemoteAvatarCacheUrlAllowed(src)) {
    return `/avatarproxy/remote?url=${encodeURIComponent(src)}`;
  }

  return src;
};
