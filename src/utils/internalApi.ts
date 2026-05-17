const LOOPBACK_HOST = '127.0.0.1';

const normalizeInternalApiHost = (host?: string): string => {
  if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') {
    return LOOPBACK_HOST;
  }

  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }

  return host;
};

export const getInternalApiBaseUrl = (): string => {
  const host = normalizeInternalApiHost(process.env.HOST);
  const port = process.env.PORT || 5055;

  return `http://${host}:${port}`;
};
