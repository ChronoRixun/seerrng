const SAFE_EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'plex:',
  'emby:',
  'jellyfin:',
]);

export const getSafeHref = (href?: null | string): string | undefined => {
  if (!href) {
    return undefined;
  }

  const trimmedHref = href.trim();

  if (!trimmedHref) {
    return undefined;
  }

  if (trimmedHref.startsWith('/') && !trimmedHref.startsWith('//')) {
    return trimmedHref;
  }

  if (trimmedHref.startsWith('#')) {
    return trimmedHref;
  }

  try {
    const url = new URL(trimmedHref);

    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? trimmedHref : undefined;
  } catch {
    return undefined;
  }
};

export const isExternalHref = (href: string): boolean => {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
};
