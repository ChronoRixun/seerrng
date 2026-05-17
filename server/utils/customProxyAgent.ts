import type { ProxySettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isLocalOrPrivateAddress } from '@server/utils/security';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Dispatcher } from 'undici';
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';

export let requestInterceptorFunction: (
  config: InternalAxiosRequestConfig
) => InternalAxiosRequestConfig = (config) => config;

export const PROXY_CONNECTIVITY_CHECK_OPTIONS = {
  timeout: 5_000,
  maxContentLength: 1024,
  maxBodyLength: 1024,
} as const;

const getAxiosRequestUrl = (
  config: InternalAxiosRequestConfig
): string | URL | undefined => {
  if (!config.url) {
    return config.baseURL;
  }

  try {
    return config.baseURL ? new URL(config.url, config.baseURL) : config.url;
  } catch {
    return config.url;
  }
};

export default async function createCustomProxyAgent(
  proxySettings: ProxySettings,
  forceIpv4First?: boolean
) {
  const defaultAgent = new Agent({
    keepAliveTimeout: 5000,
    connections: 50,
    connect: forceIpv4First ? { family: 4 } : undefined,
  });

  const skipUrl = (url: string | URL) => {
    let hostname: string;
    try {
      hostname = typeof url === 'string' ? new URL(url).hostname : url.hostname;
    } catch {
      return false;
    }

    if (
      proxySettings.bypassLocalAddresses &&
      isLocalOrPrivateAddress(hostname)
    ) {
      return true;
    }

    for (const address of proxySettings.bypassFilter.split(',')) {
      const trimmedAddress = address.trim();
      if (!trimmedAddress) {
        continue;
      }

      if (trimmedAddress.startsWith('*')) {
        const domain = trimmedAddress.slice(1);
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          return true;
        }
      } else if (hostname === trimmedAddress) {
        return true;
      }
    }

    return false;
  };

  const noProxyInterceptor = (
    dispatch: Dispatcher['dispatch']
  ): Dispatcher['dispatch'] => {
    return (opts, handler) => {
      return opts.origin && skipUrl(opts.origin)
        ? defaultAgent.dispatch(opts, handler)
        : dispatch(opts, handler);
    };
  };

  const token =
    proxySettings.user && proxySettings.password
      ? `Basic ${Buffer.from(
          `${proxySettings.user}:${proxySettings.password}`
        ).toString('base64')}`
      : undefined;

  try {
    const proxyUrl = `${proxySettings.useSsl ? 'https' : 'http'}://${
      proxySettings.hostname
    }:${proxySettings.port}`;
    const proxyAgent = new ProxyAgent({
      uri: proxyUrl,
      token,
      keepAliveTimeout: 5000,
      connections: 50,
      connect: forceIpv4First ? { family: 4 } : undefined,
    });

    setGlobalDispatcher(proxyAgent.compose(noProxyInterceptor));

    const agentOptions = {
      headers: token ? { 'proxy-authorization': token } : undefined,
      keepAlive: true,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 5000,
      scheduling: 'lifo' as const,
      family: forceIpv4First ? 4 : undefined,
    };
    axios.defaults.httpAgent = new HttpProxyAgent(proxyUrl, agentOptions);
    axios.defaults.httpsAgent = new HttpsProxyAgent(proxyUrl, agentOptions);

    requestInterceptorFunction = (config) => {
      const url = getAxiosRequestUrl(config);
      if (url && skipUrl(url)) {
        config.httpAgent = false;
        config.httpsAgent = false;
      }
      return config;
    };
    axios.interceptors.request.use(requestInterceptorFunction);
  } catch (e) {
    logger.error('Failed to connect to the proxy: ' + e.message, {
      label: 'Proxy',
    });
    setGlobalDispatcher(defaultAgent);
    return;
  }

  try {
    await axios.head(
      'https://www.google.com',
      PROXY_CONNECTIVITY_CHECK_OPTIONS
    );
    logger.debug('HTTP(S) proxy connected successfully', { label: 'Proxy' });
  } catch (e) {
    logger.error(
      'Failed to connect to the proxy: ' + e.message + ': ' + e.cause,
      { label: 'Proxy' }
    );
    setGlobalDispatcher(defaultAgent);
  }
}
