import JellyfinAPI from '@server/api/jellyfin';
import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import TautulliAPI from '@server/api/tautulli';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import type { PlexConnection } from '@server/interfaces/api/plexInterfaces';
import type {
  LogMessage,
  LogsResultsResponse,
  SettingsAboutResponse,
} from '@server/interfaces/api/settingsInterfaces';
import { scheduledJobs } from '@server/job/schedule';
import type { AvailableCacheIds } from '@server/lib/cache';
import cacheManager, { isAvailableCacheId } from '@server/lib/cache';
import ImageProxy from '@server/lib/imageproxy';
import { MAX_PERMISSION_VALUE, Permission } from '@server/lib/permissions';
import { jellyfinFullScanner } from '@server/lib/scanners/jellyfin';
import { plexFullScanner } from '@server/lib/scanners/plex';
import type { JobId, Library, MainSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import discoverSettingRoutes from '@server/routes/settings/discover';
import { ApiError } from '@server/types/error';
import { appDataPath } from '@server/utils/appDataVolume';
import { getAppVersion } from '@server/utils/appVersion';
import { dnsCache } from '@server/utils/dnsCache';
import { getHostname } from '@server/utils/getHostname';
import { parsePageParams } from '@server/utils/pagination';
import {
  isValidHttpUrl,
  preserveRedactedSecrets,
  redactSecrets,
} from '@server/utils/security';
import {
  parseBoundedString,
  parseOptionalAllowedString,
  parseOptionalBodyBoolean,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
  parseOptionalQueryBoolean,
} from '@server/utils/validation';
import type { DnsEntries, DnsStats } from 'dns-caching';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { escapeRegExp, merge, omit, set, sortBy } from 'lodash';
import { rescheduleJob } from 'node-schedule';
import path from 'path';
import semver from 'semver';
import { URL } from 'url';
import lidarrRoutes from './lidarr';
import metadataRoutes from './metadata';
import notificationRoutes from './notifications';
import radarrRoutes from './radarr';
import readarrRoutes from './readarr';
import sonarrRoutes from './sonarr';

const settingsRoutes = Router();
const MAX_LOG_READ_BYTES = 2 * 1024 * 1024;
const MAX_LOG_LINE_BYTES = 64 * 1024;
const MAX_LOG_SEARCH_DEPTH = 8;
const MAX_LOG_SEARCH_VALUES = 500;
const MAX_LOG_SEARCH_LENGTH = 200;
const MAX_JOB_SCHEDULE_LENGTH = 100;
const MAX_LIBRARY_ENABLE_QUERY_LENGTH = 4096;
const MAX_SETTINGS_PATH_ID_LENGTH = 128;
const MAX_NETWORK_TIMEOUT_MS = 300_000;
const MAX_PROXY_STRING_LENGTH = 512;
const MAX_PROXY_BYPASS_LENGTH = 4096;
const MAX_PROXY_PORT = 65_535;
const MAX_DNS_CACHE_TTL = 86_400;
const MAX_MAIN_STRING_LENGTH = 512;
const MAX_BLOCKLISTED_TAGS_LENGTH = 4096;
const MAX_BLOCKLISTED_TAGS_LIMIT = 250;
const MAX_DEFAULT_QUOTA_VALUE = 10_000;
const logFilters = ['debug', 'info', 'warn', 'error'] as const;

const parseEnableList = (value: unknown) => {
  const parsed = parseOptionalBoundedString(value, {
    fieldName: 'Enabled libraries',
    maxLength: MAX_LIBRARY_ENABLE_QUERY_LENGTH,
  });

  if ('error' in parsed) {
    return parsed;
  }

  return {
    value: parsed.value
      ? parsed.value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : [],
  };
};

const parseSettingsPathId = (value: unknown, fieldName: string) =>
  parseBoundedString(value, {
    fieldName,
    maxLength: MAX_SETTINGS_PATH_ID_LENGTH,
  });

const findScheduledJob = (value: unknown) => {
  const jobId = parseSettingsPathId(value, 'Job ID');
  if ('error' in jobId) {
    return undefined;
  }

  return scheduledJobs.find((job) => job.id === jobId.value);
};

const getScheduledJobResponse = (
  scheduledJob: (typeof scheduledJobs)[number]
) => ({
  id: scheduledJob.id,
  name: scheduledJob.name,
  type: scheduledJob.type,
  interval: scheduledJob.interval,
  cronSchedule: scheduledJob.cronSchedule,
  nextExecutionTime: scheduledJob.job.nextInvocation(),
  running: scheduledJob.running ? scheduledJob.running() : false,
});

const parseSettingsBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Settings body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
};

const parseOptionalSettingsBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (body === undefined || body === null) {
    return { value: {} };
  }

  return parseSettingsBodyObject(body);
};

const validateOptionalHttpUrl = (
  value: unknown,
  fieldName: string
): { value: string | undefined } | { error: string } => {
  const parsed = parseOptionalBoundedString(value, {
    fieldName,
    maxLength: 512,
  });

  if ('error' in parsed || parsed.value === undefined) {
    return parsed;
  }

  return isValidHttpUrl(parsed.value)
    ? parsed
    : { error: `${fieldName} must be a valid HTTP URL.` };
};

const parseOptionalBooleanSetting = (
  value: unknown,
  fieldName: string
): { value: boolean | undefined } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: undefined };
  }

  return typeof value === 'boolean'
    ? { value }
    : { error: `${fieldName} must be a boolean.` };
};

const parseOptionalNetworkInteger = (
  value: unknown,
  fieldName: string,
  max: number
): { value: number | undefined } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: undefined };
  }

  const parsed = parseOptionalNonNegativeInteger(value, max);
  return parsed === undefined
    ? { error: `${fieldName} must be a valid number.` }
    : { value: parsed };
};

const parseNetworkSettingsBody = (
  body: Record<string, unknown>
): { value: Record<string, unknown> } | { error: string } => {
  const value = { ...body };

  for (const [key, fieldName] of [
    ['csrfProtection', 'csrfProtection'],
    ['forceIpv4First', 'forceIpv4First'],
    ['trustProxy', 'trustProxy'],
  ] as const) {
    const parsed = parseOptionalBooleanSetting(value[key], fieldName);
    if ('error' in parsed) {
      return parsed;
    }
    value[key] = parsed.value;
  }

  if (value.apiRequestTimeout !== undefined) {
    const parsedTimeout = parseOptionalNetworkInteger(
      value.apiRequestTimeout,
      'apiRequestTimeout',
      MAX_NETWORK_TIMEOUT_MS
    );
    if ('error' in parsedTimeout) {
      return parsedTimeout;
    }
    value.apiRequestTimeout = parsedTimeout.value;
  }

  if (value.dnsCache !== undefined) {
    if (
      !value.dnsCache ||
      typeof value.dnsCache !== 'object' ||
      Array.isArray(value.dnsCache)
    ) {
      return { error: 'dnsCache must be an object.' };
    }

    const dnsCache = { ...(value.dnsCache as Record<string, unknown>) };
    const enabled = parseOptionalBooleanSetting(
      dnsCache.enabled,
      'dnsCache.enabled'
    );
    if ('error' in enabled) {
      return enabled;
    }
    dnsCache.enabled = enabled.value;

    for (const [key, fieldName] of [
      ['forceMinTtl', 'dnsCache.forceMinTtl'],
      ['forceMaxTtl', 'dnsCache.forceMaxTtl'],
    ] as const) {
      const parsed = parseOptionalNetworkInteger(
        dnsCache[key],
        fieldName,
        MAX_DNS_CACHE_TTL
      );
      if ('error' in parsed) {
        return parsed;
      }
      dnsCache[key] = parsed.value;
    }

    value.dnsCache = dnsCache;
  }

  if (value.proxy !== undefined) {
    if (
      !value.proxy ||
      typeof value.proxy !== 'object' ||
      Array.isArray(value.proxy)
    ) {
      return { error: 'proxy must be an object.' };
    }

    const proxy = { ...(value.proxy as Record<string, unknown>) };

    for (const [key, fieldName] of [
      ['enabled', 'proxy.enabled'],
      ['useSsl', 'proxy.useSsl'],
      ['bypassLocalAddresses', 'proxy.bypassLocalAddresses'],
    ] as const) {
      const parsed = parseOptionalBooleanSetting(proxy[key], fieldName);
      if ('error' in parsed) {
        return parsed;
      }
      proxy[key] = parsed.value;
    }

    for (const [key, fieldName, maxLength] of [
      ['hostname', 'proxy.hostname', MAX_PROXY_STRING_LENGTH],
      ['user', 'proxy.user', MAX_PROXY_STRING_LENGTH],
      ['password', 'proxy.password', MAX_PROXY_STRING_LENGTH],
      ['bypassFilter', 'proxy.bypassFilter', MAX_PROXY_BYPASS_LENGTH],
    ] as const) {
      const parsed = parseOptionalBoundedString(proxy[key], {
        fieldName,
        maxLength,
      });
      if ('error' in parsed) {
        return parsed;
      }
      proxy[key] = parsed.value;
    }

    const port = parseOptionalNetworkInteger(
      proxy.port,
      'proxy.port',
      MAX_PROXY_PORT
    );
    if ('error' in port) {
      return port;
    }
    if (
      proxy.enabled === true &&
      (!proxy.hostname || port.value === undefined || port.value < 1)
    ) {
      return {
        error: 'proxy hostname and port are required when proxy is enabled.',
      };
    }
    proxy.port = port.value;

    value.proxy = proxy;
  }

  return { value };
};

const parseMainSettingsBody = (
  body: Record<string, unknown>
): { value: Record<string, unknown> } | { error: string } => {
  const value = { ...body };

  for (const [key, fieldName] of [
    ['applicationTitle', 'applicationTitle'],
    ['locale', 'locale'],
    ['discoverRegion', 'discoverRegion'],
    ['streamingRegion', 'streamingRegion'],
    ['originalLanguage', 'originalLanguage'],
    ['blocklistRegion', 'blocklistRegion'],
    ['blocklistLanguage', 'blocklistLanguage'],
  ] as const) {
    const parsed = parseOptionalBoundedString(value[key], {
      fieldName,
      maxLength: MAX_MAIN_STRING_LENGTH,
    });
    if ('error' in parsed) {
      return parsed;
    }
    value[key] = parsed.value;
  }

  const blocklistedTags = parseOptionalBoundedString(value.blocklistedTags, {
    fieldName: 'blocklistedTags',
    maxLength: MAX_BLOCKLISTED_TAGS_LENGTH,
  });
  if ('error' in blocklistedTags) {
    return blocklistedTags;
  }
  value.blocklistedTags = blocklistedTags.value;

  for (const [key, fieldName] of [
    ['hideAvailable', 'hideAvailable'],
    ['hideBlocklisted', 'hideBlocklisted'],
    ['localLogin', 'localLogin'],
    ['mediaServerLogin', 'mediaServerLogin'],
    ['newPlexLogin', 'newPlexLogin'],
    ['partialRequestsEnabled', 'partialRequestsEnabled'],
    ['enableSpecialEpisodes', 'enableSpecialEpisodes'],
    ['cacheImages', 'cacheImages'],
  ] as const) {
    const parsed = parseOptionalBooleanSetting(value[key], fieldName);
    if ('error' in parsed) {
      return parsed;
    }
    value[key] = parsed.value;
  }

  for (const [key, fieldName, max] of [
    [
      'blocklistedTagsLimit',
      'blocklistedTagsLimit',
      MAX_BLOCKLISTED_TAGS_LIMIT,
    ],
    ['defaultPermissions', 'defaultPermissions', MAX_PERMISSION_VALUE],
  ] as const) {
    const parsed = parseOptionalNetworkInteger(value[key], fieldName, max);
    if ('error' in parsed) {
      return parsed;
    }
    value[key] = parsed.value;
  }

  if (value.mediaServerType !== undefined) {
    const parsed = parseOptionalNetworkInteger(
      value.mediaServerType,
      'mediaServerType',
      MediaServerType.NOT_CONFIGURED
    );
    if ('error' in parsed || parsed.value === undefined || parsed.value < 1) {
      return { error: 'mediaServerType must be valid.' };
    }
    value.mediaServerType = parsed.value;
  }

  if (value.defaultQuotas !== undefined) {
    if (
      !value.defaultQuotas ||
      typeof value.defaultQuotas !== 'object' ||
      Array.isArray(value.defaultQuotas)
    ) {
      return { error: 'defaultQuotas must be an object.' };
    }

    const defaultQuotas = {
      ...(value.defaultQuotas as Record<string, unknown>),
    };

    for (const mediaType of ['movie', 'tv', 'music', 'book'] as const) {
      if (defaultQuotas[mediaType] === undefined) {
        continue;
      }

      if (
        !defaultQuotas[mediaType] ||
        typeof defaultQuotas[mediaType] !== 'object' ||
        Array.isArray(defaultQuotas[mediaType])
      ) {
        return { error: `defaultQuotas.${mediaType} must be an object.` };
      }

      const quota = {
        ...(defaultQuotas[mediaType] as Record<string, unknown>),
      };

      for (const [key, fieldName] of [
        ['quotaLimit', `defaultQuotas.${mediaType}.quotaLimit`],
        ['quotaDays', `defaultQuotas.${mediaType}.quotaDays`],
      ] as const) {
        const parsed = parseOptionalNetworkInteger(
          quota[key],
          fieldName,
          MAX_DEFAULT_QUOTA_VALUE
        );
        if ('error' in parsed) {
          return parsed;
        }
        quota[key] = parsed.value;
      }

      defaultQuotas[mediaType] = quota;
    }

    value.defaultQuotas = defaultQuotas;
  }

  for (const [key, fieldName] of [
    ['applicationUrl', 'applicationUrl'],
    ['youtubeUrl', 'youtubeUrl'],
  ] as const) {
    const parsed = validateOptionalHttpUrl(value[key], fieldName);
    if ('error' in parsed) {
      return parsed;
    }
    if (parsed.value?.endsWith('/')) {
      return { error: `${fieldName} must not end with a slash.` };
    }
    value[key] = parsed.value;
  }

  return { value };
};

const readLogTail = async (
  logFile: string,
  maxBytes = MAX_LOG_READ_BYTES
): Promise<string> => {
  const stat = await fs.promises.stat(logFile);
  const start = Math.max(stat.size - maxBytes, 0);
  const length = stat.size - start;

  const handle = await fs.promises.open(logFile, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const content = buffer.toString('utf-8');

    if (start === 0) {
      return content;
    }

    const firstNewline = content.indexOf('\n');
    return firstNewline === -1 ? '' : content.slice(firstNewline + 1);
  } finally {
    await handle.close();
  }
};

export const deepLogValueStrings = (
  obj: Record<string, unknown>,
  maxDepth = MAX_LOG_SEARCH_DEPTH,
  maxValues = MAX_LOG_SEARCH_VALUES
): string[] => {
  const values: string[] = [];
  const stack: { value: unknown; depth: number }[] = [{ value: obj, depth: 0 }];

  while (stack.length && values.length < maxValues) {
    const item = stack.pop();
    if (!item) {
      break;
    }

    const { value, depth } = item;

    if (typeof value === 'string') {
      values.push(value);
      continue;
    }

    if (typeof value === 'number') {
      values.push(value.toString());
      continue;
    }

    if (!value || typeof value !== 'object' || depth >= maxDepth) {
      continue;
    }

    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      stack.push({ value: nestedValue, depth: depth + 1 });
    }
  }

  return values;
};

export const parseLogMessages = (
  logContent: string,
  filter: string[],
  searchRegexp?: RegExp
): LogMessage[] => {
  const logs: LogMessage[] = [];
  const logMessageProperties = [
    'timestamp',
    'level',
    'label',
    'message',
    'data',
  ];

  logContent.split('\n').forEach((line) => {
    if (!line.length || Buffer.byteLength(line, 'utf8') > MAX_LOG_LINE_BYTES) {
      return;
    }

    let logMessage: LogMessage & Record<string, unknown>;
    try {
      logMessage = JSON.parse(line);
    } catch {
      return;
    }

    if (
      !filter.includes(logMessage.level) ||
      typeof logMessage.message !== 'string'
    ) {
      return;
    }

    if (
      !Object.keys(logMessage).every((key) =>
        logMessageProperties.includes(key)
      )
    ) {
      Object.keys(logMessage)
        .filter((prop) => !logMessageProperties.includes(prop))
        .forEach((prop) => {
          set(logMessage, `data.${prop}`, logMessage[prop]);
        });
    }

    if (searchRegexp) {
      if (
        // label and data are sometimes undefined
        !searchRegexp.test(logMessage.label ?? '') &&
        !searchRegexp.test(logMessage.message) &&
        !deepLogValueStrings(logMessage.data ?? {}).some((val) =>
          searchRegexp.test(val)
        )
      ) {
        return;
      }
    }

    logs.push(redactSecrets(logMessage));
  });

  return logs;
};

settingsRoutes.use('/notifications', notificationRoutes);
settingsRoutes.use('/radarr', radarrRoutes);
settingsRoutes.use('/sonarr', sonarrRoutes);
settingsRoutes.use('/lidarr', lidarrRoutes);
settingsRoutes.use('/readarr', readarrRoutes);
settingsRoutes.use('/discover', discoverSettingRoutes);
settingsRoutes.use('/metadatas', metadataRoutes);

const filteredMainSettings = (
  user: User,
  main: MainSettings
): Partial<MainSettings> => {
  if (!user?.hasPermission(Permission.ADMIN)) {
    return omit(main, 'apiKey');
  }

  // The application's own API key is intended to be readable and copyable by
  // admins (Settings → General) so they can authenticate API requests. Redact
  // every other secret in the main settings, but preserve apiKey for admins.
  return { ...redactSecrets(main), apiKey: main.apiKey };
};

settingsRoutes.get('/main', (req, res, next) => {
  const settings = getSettings();

  if (!req.user) {
    return next({ status: 400, message: 'User missing from request.' });
  }

  res.status(200).json(filteredMainSettings(req.user, settings.main));
});

settingsRoutes.post('/main', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseSettingsBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ message: parsedBody.error });
  }
  const parsedMain = parseMainSettingsBody(parsedBody.value);
  if ('error' in parsedMain) {
    return res.status(400).json({ message: parsedMain.error });
  }

  settings.main = merge(
    settings.main,
    preserveRedactedSecrets(parsedMain.value, settings.main)
  );
  await settings.save();

  return res.status(200).json(filteredMainSettings(req.user!, settings.main));
});

settingsRoutes.get('/network', (req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.network));
});

settingsRoutes.post('/network', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseSettingsBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ message: parsedBody.error });
  }
  const parsedNetwork = parseNetworkSettingsBody(parsedBody.value);
  if ('error' in parsedNetwork) {
    return res.status(400).json({ message: parsedNetwork.error });
  }

  settings.network = merge(
    settings.network,
    preserveRedactedSecrets(parsedNetwork.value, settings.network)
  );
  await settings.save();

  return res.status(200).json(redactSecrets(settings.network));
});

settingsRoutes.post('/main/regenerate', async (req, res, next) => {
  const settings = getSettings();

  const main = await settings.regenerateApiKey();

  if (!req.user) {
    return next({ status: 500, message: 'User missing from request.' });
  }

  return res.status(200).json(filteredMainSettings(req.user, main));
});

settingsRoutes.get('/plex', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.plex));
});

settingsRoutes.post('/plex', async (req, res, next) => {
  const userRepository = getRepository(User);
  const settings = getSettings();
  const parsedBody = parseSettingsBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ message: parsedBody.error });
  }

  const webAppUrl = validateOptionalHttpUrl(
    parsedBody.value.webAppUrl,
    'webAppUrl'
  );
  if ('error' in webAppUrl) {
    return res.status(400).json({ message: webAppUrl.error });
  }
  parsedBody.value.webAppUrl = webAppUrl.value;

  try {
    const admin = await userRepository.findOneOrFail({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });

    Object.assign(
      settings.plex,
      preserveRedactedSecrets(parsedBody.value, settings.plex)
    );

    const plexClient = new PlexAPI({ plexToken: admin.plexToken });

    const result = await plexClient.getStatus();

    if (!result?.MediaContainer?.machineIdentifier) {
      throw new Error('Server not found');
    }

    settings.plex.machineId = result.MediaContainer.machineIdentifier;
    settings.plex.name = result.MediaContainer.friendlyName;

    await settings.save();
  } catch (e) {
    logger.error('Something went wrong testing Plex connection', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to connect to Plex.',
    });
  }

  return res.status(200).json(redactSecrets(settings.plex));
});

settingsRoutes.get('/plex/devices/servers', async (req, res, next) => {
  const userRepository = getRepository(User);
  try {
    const admin = await userRepository.findOneOrFail({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });
    const plexTvClient = admin.plexToken
      ? new PlexTvAPI(admin.plexToken)
      : null;
    const devices = (await plexTvClient?.getDevices())?.filter((device) => {
      return device.provides.includes('server') && device.owned;
    });
    const settings = getSettings();

    if (devices) {
      await Promise.all(
        devices.map(async (device) => {
          const plexDirectConnections: PlexConnection[] = [];

          device.connection.forEach((connection) => {
            const url = new URL(connection.uri);

            if (url.hostname !== connection.address) {
              const plexDirectConnection = { ...connection };
              plexDirectConnection.address = url.hostname;
              plexDirectConnections.push(plexDirectConnection);

              // Connect to IP addresses over HTTP
              connection.protocol = 'http';
            }
          });

          plexDirectConnections.forEach((plexDirectConnection) => {
            device.connection.push(plexDirectConnection);
          });

          await Promise.all(
            device.connection.map(async (connection) => {
              const plexDeviceSettings = {
                ...settings.plex,
                ip: connection.address,
                port: connection.port,
                useSsl: connection.protocol === 'https',
              };
              const plexClient = new PlexAPI({
                plexToken: admin.plexToken,
                plexSettings: plexDeviceSettings,
                timeout: 5000,
              });

              try {
                await plexClient.getStatus();
                connection.status = 200;
                connection.message = 'OK';
              } catch (e) {
                connection.status = 500;
                connection.message = e.message.split(':')[0];
              }
            })
          );
        })
      );
    }
    return res.status(200).json(devices);
  } catch (e) {
    logger.error('Something went wrong retrieving Plex server list', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve Plex server list.',
    });
  }
});

settingsRoutes.get('/plex/library', async (req, res) => {
  const settings = getSettings();
  const sync = parseOptionalQueryBoolean(req.query.sync, 'Sync');
  if ('error' in sync) {
    return res.status(400).json({ message: sync.error });
  }

  if (sync.value) {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });
    const plexapi = new PlexAPI({ plexToken: admin.plexToken });

    await plexapi.syncLibraries();
  }

  const enabledLibraries = parseEnableList(req.query.enable);
  if ('error' in enabledLibraries) {
    return res.status(400).json({ message: enabledLibraries.error });
  }

  settings.plex.libraries = settings.plex.libraries.map((library) => ({
    ...library,
    enabled: enabledLibraries.value.includes(library.id),
  }));
  await settings.save();
  return res.status(200).json(settings.plex.libraries);
});

settingsRoutes.get('/plex/sync', (_req, res) => {
  return res.status(200).json(plexFullScanner.status());
});

settingsRoutes.post('/plex/sync', (req, res) => {
  const parsedBody = parseOptionalSettingsBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ message: parsedBody.error });
  }
  const body = parsedBody.value;

  const cancel = parseOptionalBodyBoolean(body.cancel, 'Cancel');
  if ('error' in cancel) {
    return res.status(400).json({ message: cancel.error });
  }
  const start = parseOptionalBodyBoolean(body.start, 'Start');
  if ('error' in start) {
    return res.status(400).json({ message: start.error });
  }

  if (cancel.value) {
    plexFullScanner.cancel();
  } else if (start.value) {
    plexFullScanner.run();
  }
  return res.status(200).json(plexFullScanner.status());
});

settingsRoutes.get('/jellyfin', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.jellyfin));
});

settingsRoutes.post('/jellyfin', async (req, res, next) => {
  const userRepository = getRepository(User);
  const settings = getSettings();
  const parsedBody = parseSettingsBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ message: parsedBody.error });
  }

  const externalHostname = validateOptionalHttpUrl(
    parsedBody.value.externalHostname,
    'externalHostname'
  );
  if ('error' in externalHostname) {
    return res.status(400).json({ message: externalHostname.error });
  }
  parsedBody.value.externalHostname = externalHostname.value;

  const jellyfinForgotPasswordUrl = validateOptionalHttpUrl(
    parsedBody.value.jellyfinForgotPasswordUrl,
    'jellyfinForgotPasswordUrl'
  );
  if ('error' in jellyfinForgotPasswordUrl) {
    return res.status(400).json({ message: jellyfinForgotPasswordUrl.error });
  }
  parsedBody.value.jellyfinForgotPasswordUrl = jellyfinForgotPasswordUrl.value;

  try {
    const admin = await userRepository.findOneOrFail({
      where: { id: 1 },
      select: ['id', 'jellyfinUserId', 'jellyfinDeviceId'],
      order: { id: 'ASC' },
    });

    const sanitizedBody = preserveRedactedSecrets(
      parsedBody.value,
      settings.jellyfin
    );
    const tempJellyfinSettings = { ...settings.jellyfin, ...sanitizedBody };

    const jellyfinClient = new JellyfinAPI(
      getHostname(tempJellyfinSettings),
      tempJellyfinSettings.apiKey,
      admin.jellyfinDeviceId ?? ''
    );

    const result = await jellyfinClient.getSystemInfo();

    if (!result?.Id) {
      throw new ApiError(result?.status, ApiErrorCode.InvalidUrl);
    }

    Object.assign(settings.jellyfin, sanitizedBody);
    settings.jellyfin.serverId = result.Id;
    settings.jellyfin.name = result.ServerName;
    await settings.save();
  } catch (e) {
    if (e instanceof ApiError) {
      logger.error('Something went wrong testing Jellyfin connection', {
        label: 'API',
        status: e.statusCode,
        errorMessage: ApiErrorCode.InvalidUrl,
      });

      return next({
        status: e.statusCode,
        message: ApiErrorCode.InvalidUrl,
      });
    } else {
      logger.error('Something went wrong', {
        label: 'API',
        errorMessage: e.message,
      });

      return next({
        status: e.statusCode ?? 500,
        message: ApiErrorCode.Unknown,
      });
    }
  }

  return res.status(200).json(redactSecrets(settings.jellyfin));
});

settingsRoutes.get('/jellyfin/library', async (req, res, next) => {
  const settings = getSettings();
  const sync = parseOptionalQueryBoolean(req.query.sync, 'Sync');
  if ('error' in sync) {
    return res.status(400).json({ message: sync.error });
  }

  if (sync.value) {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
      where: { id: 1 },
      order: { id: 'ASC' },
    });
    const jellyfinClient = new JellyfinAPI(
      getHostname(),
      settings.jellyfin.apiKey,
      admin.jellyfinDeviceId ?? ''
    );

    jellyfinClient.setUserId(admin.jellyfinUserId ?? '');

    const libraries = await jellyfinClient.getLibraries();

    if (libraries.length === 0) {
      // Check if no libraries are found due to the fallback to user views
      // This only affects LDAP users
      const account = await jellyfinClient.getUser();

      // Automatic Library grouping is not supported when user views are used to get library
      if (account.Configuration.GroupedFolders?.length > 0) {
        return next({
          status: 501,
          message: ApiErrorCode.SyncErrorGroupedFolders,
        });
      }

      return next({ status: 404, message: ApiErrorCode.SyncErrorNoLibraries });
    }

    const newLibraries: Library[] = libraries.map((library) => {
      const existing = settings.jellyfin.libraries.find(
        (l) => l.id === library.key && l.name === library.title
      );

      return {
        id: library.key,
        name: library.title,
        enabled: existing?.enabled ?? false,
        type: library.type,
      };
    });

    settings.jellyfin.libraries = newLibraries;
  }

  const enabledLibraries = parseEnableList(req.query.enable);
  if ('error' in enabledLibraries) {
    return res.status(400).json({ message: enabledLibraries.error });
  }

  settings.jellyfin.libraries = settings.jellyfin.libraries.map((library) => ({
    ...library,
    enabled: enabledLibraries.value.includes(library.id),
  }));
  await settings.save();
  return res.status(200).json(settings.jellyfin.libraries);
});

settingsRoutes.get('/jellyfin/users', async (req, res) => {
  const settings = getSettings();

  const userRepository = getRepository(User);
  const admin = await userRepository.findOneOrFail({
    select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
    where: { id: 1 },
    order: { id: 'ASC' },
  });
  const jellyfinClient = new JellyfinAPI(
    getHostname(),
    settings.jellyfin.apiKey,
    admin.jellyfinDeviceId ?? ''
  );

  jellyfinClient.setUserId(admin.jellyfinUserId ?? '');
  const resp = await jellyfinClient.getUsers();
  const jellyfinUsers = resp.users.map((user) => ({
    username: user.Name,
    id: user.Id,
    thumb: `/avatarproxy/${user.Id}`,
    email: user.Name,
  }));

  return res.status(200).json(jellyfinUsers);
});

settingsRoutes.get('/jellyfin/sync', (_req, res) => {
  return res.status(200).json(jellyfinFullScanner.status());
});

settingsRoutes.post('/jellyfin/sync', (req, res) => {
  const parsedBody = parseOptionalSettingsBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ message: parsedBody.error });
  }
  const body = parsedBody.value;

  const cancel = parseOptionalBodyBoolean(body.cancel, 'Cancel');
  if ('error' in cancel) {
    return res.status(400).json({ message: cancel.error });
  }
  const start = parseOptionalBodyBoolean(body.start, 'Start');
  if ('error' in start) {
    return res.status(400).json({ message: start.error });
  }

  if (cancel.value) {
    jellyfinFullScanner.cancel();
  } else if (start.value) {
    jellyfinFullScanner.run();
  }
  return res.status(200).json(jellyfinFullScanner.status());
});
settingsRoutes.get('/tautulli', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.tautulli));
});

settingsRoutes.post('/tautulli', async (req, res, next) => {
  const settings = getSettings();
  const parsedBody = parseSettingsBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ message: parsedBody.error });
  }

  const externalUrl = validateOptionalHttpUrl(
    parsedBody.value.externalUrl,
    'externalUrl'
  );
  if ('error' in externalUrl) {
    return res.status(400).json({ message: externalUrl.error });
  }
  parsedBody.value.externalUrl = externalUrl.value;

  Object.assign(
    settings.tautulli,
    preserveRedactedSecrets(parsedBody.value, settings.tautulli)
  );

  if (settings.tautulli.hostname) {
    try {
      const tautulliClient = new TautulliAPI(settings.tautulli);

      const result = await tautulliClient.getInfo();

      if (!semver.gte(semver.coerce(result?.tautulli_version) ?? '', '2.9.0')) {
        throw new Error('Tautulli version not supported');
      }

      await settings.save();
    } catch (e) {
      logger.error('Something went wrong testing Tautulli connection', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to connect to Tautulli.',
      });
    }
  }

  return res.status(200).json(redactSecrets(settings.tautulli));
});

settingsRoutes.get(
  '/plex/users',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const userRepository = getRepository(User);
    const qb = userRepository.createQueryBuilder('user');

    try {
      const admin = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });
      const plexApi = new PlexTvAPI(admin.plexToken ?? '');
      const plexUsers = (await plexApi.getUsers()).MediaContainer.User.map(
        (user) => user.$
      ).filter((user) => user.email);

      const unimportedPlexUsers: {
        id: string;
        title: string;
        username: string;
        email: string;
        thumb: string;
      }[] = [];

      const plexIds = plexUsers.map((plexUser) => plexUser.id);
      const plexEmails = plexUsers.map((plexUser) =>
        plexUser.email.toLowerCase()
      );
      if (!plexIds.length) plexIds.push('-1');
      if (!plexEmails.length) plexEmails.push('@');

      const existingUsers = await qb
        .where('user.plexId IN (:...plexIds)', { plexIds })
        .orWhere('user.email IN (:...plexEmails)', { plexEmails })
        .getMany();

      await Promise.all(
        plexUsers.map(async (plexUser) => {
          if (
            !existingUsers.find(
              (user) =>
                user.plexId === parseInt(plexUser.id) ||
                user.email === plexUser.email.toLowerCase()
            ) &&
            (await plexApi.checkUserAccess(parseInt(plexUser.id)))
          ) {
            unimportedPlexUsers.push(plexUser);
          }
        })
      );

      return res.status(200).json(sortBy(unimportedPlexUsers, 'username'));
    } catch (e) {
      logger.error('Something went wrong getting unimported Plex users', {
        label: 'API',
        errorMessage: e.message,
      });
      next({
        status: 500,
        message: 'Unable to retrieve unimported Plex users.',
      });
    }
  }
);

settingsRoutes.get(
  '/logs',
  rateLimit({ windowMs: 60 * 1000, max: 50 }),
  async (req, res, next) => {
    const { pageSize, skip } = parsePageParams(req.query, {
      take: 25,
      maxTake: 100,
    });
    const parsedSearch = parseOptionalBoundedString(req.query.search, {
      fieldName: 'Search',
      maxLength: MAX_LOG_SEARCH_LENGTH,
    });
    if ('error' in parsedSearch) {
      return next({ status: 400, message: parsedSearch.error });
    }
    const parsedFilter = parseOptionalAllowedString(req.query.filter, {
      fieldName: 'Filter',
      allowedValues: logFilters,
      maxLength: 16,
    });
    if ('error' in parsedFilter) {
      return next({ status: 400, message: parsedFilter.error });
    }
    const search = parsedSearch.value ?? '';
    const searchRegexp = search
      ? new RegExp(escapeRegExp(search), 'i')
      : undefined;

    let filter: string[] = [];
    switch (parsedFilter.value) {
      case 'debug':
        filter.push('debug');
      // falls through
      case 'info':
        filter.push('info');
      // falls through
      case 'warn':
        filter.push('warn');
      // falls through
      case 'error':
        filter.push('error');
        break;
      default:
        filter = ['debug', 'info', 'warn', 'error'];
    }

    const logFile = process.env.CONFIG_DIRECTORY
      ? `${process.env.CONFIG_DIRECTORY}/logs/.machinelogs.json`
      : path.join(__dirname, '../../../config/logs/.machinelogs.json');
    try {
      const logContent = await readLogTail(logFile);
      const logs = parseLogMessages(logContent, filter, searchRegexp);

      const displayedLogs = logs.reverse().slice(skip, skip + pageSize);

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(logs.length / pageSize),
          pageSize,
          results: logs.length,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: displayedLogs,
      } as LogsResultsResponse);
    } catch (error) {
      logger.error('Something went wrong while retrieving logs', {
        label: 'Logs',
        errorMessage: error.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve logs.',
      });
    }
  }
);

settingsRoutes.get('/jobs', (_req, res) => {
  return res.status(200).json(scheduledJobs.map(getScheduledJobResponse));
});

settingsRoutes.post<{ jobId: string }>('/jobs/:jobId/run', (req, res, next) => {
  const scheduledJob = findScheduledJob(req.params.jobId);
  if (!scheduledJob) {
    return next({ status: 404, message: 'Job not found.' });
  }

  if (scheduledJob.running?.()) {
    return next({ status: 409, message: 'Job is already running.' });
  }

  scheduledJob.job.invoke();

  return res.status(200).json(getScheduledJobResponse(scheduledJob));
});

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/cancel',
  (req, res, next) => {
    const scheduledJob = findScheduledJob(req.params.jobId);
    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    if (scheduledJob.cancelFn) {
      scheduledJob.cancelFn();
    }

    return res.status(200).json(getScheduledJobResponse(scheduledJob));
  }
);

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/schedule',
  async (req, res, next) => {
    const scheduledJob = findScheduledJob(req.params.jobId);
    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    if (
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      typeof (req.body as { schedule?: unknown }).schedule !== 'string' ||
      !(req.body as { schedule: string }).schedule.trim() ||
      (req.body as { schedule: string }).schedule.length >
        MAX_JOB_SCHEDULE_LENGTH
    ) {
      return next({ status: 400, message: 'Invalid job schedule.' });
    }

    const schedule = (req.body as { schedule: string }).schedule.trim();
    const result = rescheduleJob(scheduledJob.job, schedule);
    const settings = getSettings();

    if (result) {
      settings.jobs[scheduledJob.id].schedule = schedule;
      await settings.save();

      scheduledJob.cronSchedule = schedule;

      return res.status(200).json(getScheduledJobResponse(scheduledJob));
    } else {
      return next({ status: 400, message: 'Invalid job schedule.' });
    }
  }
);

settingsRoutes.get('/cache', async (_req, res) => {
  const cacheManagerCaches = cacheManager.getAllCaches();

  const apiCaches = Object.values(cacheManagerCaches).map((cache) => ({
    id: cache.id,
    name: cache.name,
    stats: cache.getStats(),
  }));

  const tmdbImageCache = await ImageProxy.getImageStats('tmdb');
  const avatarImageCache = await ImageProxy.getImageStats('avatar');

  const stats: DnsStats | undefined = dnsCache?.getStats();
  const entries: DnsEntries | undefined = dnsCache?.getCacheEntries();

  return res.status(200).json({
    apiCaches,
    imageCache: {
      tmdb: tmdbImageCache,
      avatar: avatarImageCache,
    },
    dnsCache: {
      stats,
      entries,
    },
  });
});

settingsRoutes.post<{ cacheId: AvailableCacheIds }>(
  '/cache/:cacheId/flush',
  (req, res, next) => {
    const cacheId = parseSettingsPathId(req.params.cacheId, 'Cache ID');
    if ('error' in cacheId) {
      return next({ status: 404, message: 'Cache not found.' });
    }

    if (!isAvailableCacheId(cacheId.value)) {
      return next({ status: 404, message: 'Cache not found.' });
    }

    const cache = cacheManager.getCache(cacheId.value);

    if (cache) {
      cache.flush();
      return res.status(204).send();
    }

    next({ status: 404, message: 'Cache not found.' });
  }
);

settingsRoutes.post<{ dnsEntry: string }>(
  '/cache/dns/:dnsEntry/flush',
  (req, res, next) => {
    const dnsEntry = parseSettingsPathId(
      req.params.dnsEntry,
      'DNS cache entry'
    );
    if ('error' in dnsEntry) {
      return next({ status: 404, message: 'Cache not found.' });
    }

    if (dnsCache) {
      dnsCache.clear(dnsEntry.value);
      return res.status(204).send();
    }

    next({ status: 404, message: 'Cache not found.' });
  }
);

settingsRoutes.post(
  '/initialize',
  isAuthenticated(Permission.ADMIN),
  async (_req, res) => {
    const settings = getSettings();

    settings.public.initialized = true;
    await settings.save();

    return res.status(200).json(settings.public);
  }
);

settingsRoutes.get('/about', async (req, res) => {
  const mediaRepository = getRepository(Media);
  const mediaRequestRepository = getRepository(MediaRequest);

  const totalMediaItems = await mediaRepository.count();
  const totalRequests = await mediaRequestRepository.count();

  return res.status(200).json({
    version: getAppVersion(),
    totalMediaItems,
    totalRequests,
    tz: process.env.TZ,
    appDataPath: appDataPath(),
  } as SettingsAboutResponse);
});

export default settingsRoutes;
