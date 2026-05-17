const REMOTE_AVATAR_HOSTS = new Set([
  'gravatar.com',
  'secure.gravatar.com',
  'www.gravatar.com',
]);

const REMOTE_AVATAR_DOMAIN_SUFFIXES = ['.gravatar.com', '.plex.tv'];

export const isRemoteAvatarCacheUrlAllowed = (avatarUrl: URL): boolean => {
  if (avatarUrl.protocol !== 'https:') {
    return false;
  }

  if (avatarUrl.username || avatarUrl.password) {
    return false;
  }

  const hostname = avatarUrl.hostname.toLowerCase();

  return (
    REMOTE_AVATAR_HOSTS.has(hostname) ||
    REMOTE_AVATAR_DOMAIN_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
};

export const getRemoteAvatarCacheUrl = (value: unknown): string | undefined => {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (typeof rawValue !== 'string') {
    return undefined;
  }

  try {
    const avatarUrl = new URL(rawValue);

    return isRemoteAvatarCacheUrlAllowed(avatarUrl)
      ? avatarUrl.toString()
      : undefined;
  } catch {
    return undefined;
  }
};
