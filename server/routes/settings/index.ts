import JellyfinAPI from '@server/api/jellyfin';
import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import TautulliAPI from '@server/api/tautulli';
import { ApiErrorCode } from '@server/constants/error';
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
import cacheManager from '@server/lib/cache';
import ImageProxy from '@server/lib/imageproxy';
import { Permission } from '@server/lib/permissions';
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
import { preserveRedactedSecrets, redactSecrets } from '@server/utils/security';
import {
  parseBoundedString,
  parseOptionalAllowedString,
  parseOptionalBodyBoolean,
  parseOptionalBoundedString,
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
const MAX_LOG_SEARCH_LENGTH = 200;
const MAX_JOB_SCHEDULE_LENGTH = 100;
const MAX_LIBRARY_ENABLE_QUERY_LENGTH = 4096;
const MAX_SETTINGS_PATH_ID_LENGTH = 128;
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

const parseSettingsBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Settings body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
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

  return redactSecrets(main);
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

  settings.main = merge(
    settings.main,
    preserveRedactedSecrets(parsedBody.value, settings.main)
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

  settings.network = merge(
    settings.network,
    preserveRedactedSecrets(parsedBody.value, settings.network)
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
  const cancel = parseOptionalBodyBoolean(req.body.cancel, 'Cancel');
  if ('error' in cancel) {
    return res.status(400).json({ message: cancel.error });
  }
  const start = parseOptionalBodyBoolean(req.body.start, 'Start');
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
  const cancel = parseOptionalBodyBoolean(req.body.cancel, 'Cancel');
  if ('error' in cancel) {
    return res.status(400).json({ message: cancel.error });
  }
  const start = parseOptionalBodyBoolean(req.body.start, 'Start');
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
    const searchRegexp = new RegExp(escapeRegExp(search), 'i');

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
    const logs: LogMessage[] = [];
    const logMessageProperties = [
      'timestamp',
      'level',
      'label',
      'message',
      'data',
    ];

    const deepValueStrings = (obj: Record<string, unknown>): string[] => {
      const values = [];

      for (const val of Object.values(obj)) {
        if (typeof val === 'string') {
          values.push(val);
        } else if (typeof val === 'number') {
          values.push(val.toString());
        } else if (val !== null && typeof val === 'object') {
          values.push(...deepValueStrings(val as Record<string, unknown>));
        }
      }

      return values;
    };

    try {
      const logContent = await readLogTail(logFile);

      logContent.split('\n').forEach((line) => {
        if (!line.length) return;

        let logMessage: LogMessage & Record<string, unknown>;
        try {
          logMessage = JSON.parse(line);
        } catch {
          return;
        }

        if (!filter.includes(logMessage.level)) {
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

        if (search) {
          if (
            // label and data are sometimes undefined
            !searchRegexp.test(logMessage.label ?? '') &&
            !searchRegexp.test(logMessage.message) &&
            !deepValueStrings(logMessage.data ?? {}).some((val) =>
              searchRegexp.test(val)
            )
          ) {
            return;
          }
        }

        logs.push(redactSecrets(logMessage));
      });

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
  return res.status(200).json(
    scheduledJobs.map((job) => ({
      id: job.id,
      name: job.name,
      type: job.type,
      interval: job.interval,
      cronSchedule: job.cronSchedule,
      nextExecutionTime: job.job.nextInvocation(),
      running: job.running ? job.running() : false,
    }))
  );
});

settingsRoutes.post<{ jobId: string }>('/jobs/:jobId/run', (req, res, next) => {
  const jobId = parseSettingsPathId(req.params.jobId, 'Job ID');
  if ('error' in jobId) {
    return next({ status: 404, message: 'Job not found.' });
  }

  const scheduledJob = scheduledJobs.find((job) => job.id === jobId.value);

  if (!scheduledJob) {
    return next({ status: 404, message: 'Job not found.' });
  }

  scheduledJob.job.invoke();

  return res.status(200).json({
    id: scheduledJob.id,
    name: scheduledJob.name,
    type: scheduledJob.type,
    interval: scheduledJob.interval,
    cronSchedule: scheduledJob.cronSchedule,
    nextExecutionTime: scheduledJob.job.nextInvocation(),
    running: scheduledJob.running ? scheduledJob.running() : false,
  });
});

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/cancel',
  (req, res, next) => {
    const jobId = parseSettingsPathId(req.params.jobId, 'Job ID');
    if ('error' in jobId) {
      return next({ status: 404, message: 'Job not found.' });
    }

    const scheduledJob = scheduledJobs.find((job) => job.id === jobId.value);

    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    if (scheduledJob.cancelFn) {
      scheduledJob.cancelFn();
    }

    return res.status(200).json({
      id: scheduledJob.id,
      name: scheduledJob.name,
      type: scheduledJob.type,
      interval: scheduledJob.interval,
      cronSchedule: scheduledJob.cronSchedule,
      nextExecutionTime: scheduledJob.job.nextInvocation(),
      running: scheduledJob.running ? scheduledJob.running() : false,
    });
  }
);

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/schedule',
  async (req, res, next) => {
    const jobId = parseSettingsPathId(req.params.jobId, 'Job ID');
    if ('error' in jobId) {
      return next({ status: 404, message: 'Job not found.' });
    }

    const scheduledJob = scheduledJobs.find((job) => job.id === jobId.value);

    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    if (
      typeof req.body.schedule !== 'string' ||
      !req.body.schedule.trim() ||
      req.body.schedule.length > MAX_JOB_SCHEDULE_LENGTH
    ) {
      return next({ status: 400, message: 'Invalid job schedule.' });
    }

    const schedule = req.body.schedule.trim();
    const result = rescheduleJob(scheduledJob.job, schedule);
    const settings = getSettings();

    if (result) {
      settings.jobs[scheduledJob.id].schedule = schedule;
      await settings.save();

      scheduledJob.cronSchedule = schedule;

      return res.status(200).json({
        id: scheduledJob.id,
        name: scheduledJob.name,
        type: scheduledJob.type,
        interval: scheduledJob.interval,
        cronSchedule: scheduledJob.cronSchedule,
        nextExecutionTime: scheduledJob.job.nextInvocation(),
        running: scheduledJob.running ? scheduledJob.running() : false,
      });
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

    const cache = cacheManager.getCache(cacheId.value as AvailableCacheIds);

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
