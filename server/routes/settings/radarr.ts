import RadarrAPI from '@server/api/servarr/radarr';
import type { RadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { preserveRedactedSecrets, redactSecrets } from '@server/utils/security';
import { parseRadarrSettings } from '@server/utils/servarrSettings';
import { Router } from 'express';

const radarrRoutes = Router();

radarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.radarr));
});

radarrRoutes.post('/', async (req, res) => {
  const settings = getSettings();

  const parsedRadarr = parseRadarrSettings(
    preserveRedactedSecrets(req.body, undefined) as Partial<RadarrSettings>
  );

  if ('error' in parsedRadarr) {
    return res.status(400).json({ message: parsedRadarr.error });
  }

  const newRadarr = parsedRadarr.value;
  const lastItem = settings.radarr[settings.radarr.length - 1];
  newRadarr.id = lastItem ? lastItem.id + 1 : 0;

  // If we are setting this as the default, clear any previous defaults for the same type first
  // ex: if is4k is true, it will only remove defaults for other servers that have is4k set to true
  // and are the default
  if (newRadarr.isDefault) {
    settings.radarr
      .filter((radarrInstance) => radarrInstance.is4k === newRadarr.is4k)
      .forEach((radarrInstance) => {
        radarrInstance.isDefault = false;
      });
  }

  settings.radarr = [...settings.radarr, newRadarr];
  await settings.save();

  return res.status(201).json(redactSecrets(newRadarr));
});

radarrRoutes.post<
  undefined,
  Record<string, unknown>,
  RadarrSettings & { tagLabel?: string }
>('/test', async (req, res, next) => {
  try {
    const parsedRadarr = parseRadarrSettings(req.body);

    if ('error' in parsedRadarr) {
      return res.status(400).json({ message: parsedRadarr.error });
    }

    const radarr = new RadarrAPI({
      apiKey: parsedRadarr.value.apiKey,
      url: RadarrAPI.buildUrl(parsedRadarr.value, '/api/v3'),
    });

    const urlBase = await radarr
      .getSystemStatus()
      .then((value) => value.urlBase)
      .catch(() => parsedRadarr.value.baseUrl);
    const profiles = await radarr.getProfiles();
    const folders = await radarr.getRootFolders();
    const tags = await radarr.getTags();

    return res.status(200).json({
      profiles,
      rootFolders: folders.map((folder) => ({
        id: folder.id,
        path: folder.path,
      })),
      tags,
      urlBase,
    });
  } catch (e) {
    logger.error('Failed to test Radarr', {
      label: 'Radarr',
      message: e.message,
    });

    next({ status: 500, message: 'Failed to connect to Radarr' });
  }
});

radarrRoutes.put<{ id: string }, RadarrSettings, RadarrSettings>(
  '/:id',
  async (req, res, next) => {
    const settings = getSettings();
    const radarrId = parsePositiveRouteId(req.params.id);
    if (!radarrId) {
      return next({ status: '404', message: 'Settings instance not found' });
    }

    const radarrIndex = settings.radarr.findIndex((r) => r.id === radarrId);

    if (radarrIndex === -1) {
      return next({ status: '404', message: 'Settings instance not found' });
    }

    // If we are setting this as the default, clear any previous defaults for the same type first
    // ex: if is4k is true, it will only remove defaults for other servers that have is4k set to true
    // and are the default
    const parsedRadarr = parseRadarrSettings(
      preserveRedactedSecrets(
        req.body,
        settings.radarr[radarrIndex]
      ) as Partial<RadarrSettings>,
      settings.radarr[radarrIndex]
    );

    if ('error' in parsedRadarr) {
      return next({ status: 400, message: parsedRadarr.error });
    }

    if (parsedRadarr.value.isDefault) {
      settings.radarr
        .filter(
          (radarrInstance) => radarrInstance.is4k === parsedRadarr.value.is4k
        )
        .forEach((radarrInstance) => {
          radarrInstance.isDefault = false;
        });
    }

    settings.radarr[radarrIndex] = {
      ...parsedRadarr.value,
      id: radarrId,
    } as RadarrSettings;
    await settings.save();

    return res.status(200).json(redactSecrets(settings.radarr[radarrIndex]));
  }
);

radarrRoutes.get<{ id: string }>('/:id/profiles', async (req, res, next) => {
  const settings = getSettings();
  const radarrId = parsePositiveRouteId(req.params.id);
  if (!radarrId) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const radarrSettings = settings.radarr.find((r) => r.id === radarrId);

  if (!radarrSettings) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const radarr = new RadarrAPI({
    apiKey: radarrSettings.apiKey,
    url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
  });

  const profiles = await radarr.getProfiles();

  return res.status(200).json(
    profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
    }))
  );
});

radarrRoutes.delete<{ id: string }>('/:id', async (req, res, next) => {
  const settings = getSettings();
  const radarrId = parsePositiveRouteId(req.params.id);
  if (!radarrId) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const radarrIndex = settings.radarr.findIndex((r) => r.id === radarrId);

  if (radarrIndex === -1) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const removed = settings.radarr.splice(radarrIndex, 1);
  await settings.save();

  return res.status(200).json(redactSecrets(removed[0]));
});

export default radarrRoutes;
