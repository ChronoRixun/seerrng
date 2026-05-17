export const normalizeUrlBase = (value?: string): string => {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
    /[\r\n?#]/.test(trimmed)
  ) {
    return '';
  }

  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.replace(/\/+$/, '');
};

export const buildServiceUrl = ({
  useSsl,
  hostname,
  port,
  urlBase,
  path = '',
}: {
  useSsl?: boolean;
  hostname?: string;
  port?: number;
  urlBase?: string;
  path?: string;
}): string =>
  `${useSsl ? 'https' : 'http'}://${hostname ?? ''}:${port ?? ''}${normalizeUrlBase(
    urlBase
  )}${path}`;
