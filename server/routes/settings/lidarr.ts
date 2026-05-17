import LidarrAPI from '@server/api/servarr/lidarr';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { preserveRedactedSecrets, redactSecrets } from '@server/utils/security';
import { parseLidarrSettings } from '@server/utils/servarrSettings';
import { Router } from 'express';

const lidarrRoutes = Router();

lidarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.lidarr));
});

lidarrRoutes.post('/', async (req, res) => {
  const settings = getSettings();

  const parsedLidarr = parseLidarrSettings(
    preserveRedactedSecrets(req.body, undefined) as Partial<LidarrSettings>
  );

  if ('error' in parsedLidarr) {
    return res.status(400).json({ message: parsedLidarr.error });
  }

  const newLidarr = parsedLidarr.value;
  const lastItem = settings.lidarr[settings.lidarr.length - 1];
  newLidarr.id = lastItem ? lastItem.id + 1 : 0;

  if (newLidarr.isDefault) {
    settings.lidarr = settings.lidarr.map((lidarr) => ({
      ...lidarr,
      isDefault: false,
    }));
  }

  settings.lidarr = [...settings.lidarr, newLidarr];
  await settings.save();

  return res.status(201).json(redactSecrets(newLidarr));
});

lidarrRoutes.post<
  undefined,
  Record<string, unknown>,
  LidarrSettings & { tagLabel?: string }
>('/test', async (req, res, next) => {
  try {
    const parsedLidarr = parseLidarrSettings(req.body);

    if ('error' in parsedLidarr) {
      return res.status(400).json({ message: parsedLidarr.error });
    }

    const lidarr = new LidarrAPI({
      apiKey: parsedLidarr.value.apiKey,
      url: LidarrAPI.buildUrl(parsedLidarr.value, '/api/v1'),
    });

    const urlBase = await lidarr
      .getSystemStatus()
      .then((value) => value.urlBase)
      .catch(() => parsedLidarr.value.baseUrl);
    const profiles = await lidarr.getProfiles();
    const metadataProfiles = await lidarr.getMetadataProfiles();
    const folders = await lidarr.getRootFolders();
    const tags = await lidarr.getTags();

    return res.status(200).json({
      profiles,
      metadataProfiles,
      rootFolders: folders.map((folder) => ({
        id: folder.id,
        path: folder.path,
      })),
      tags,
      urlBase,
    });
  } catch (e) {
    logger.error('Failed to test Lidarr', {
      label: 'Lidarr',
      message: e.message,
    });
    next({ status: 500, message: 'Failed to connect to Lidarr' });
  }
});

lidarrRoutes.put<{ id: string }, LidarrSettings, LidarrSettings>(
  '/:id',
  async (req, res, next) => {
    const settings = getSettings();
    const lidarrId = parsePositiveRouteId(req.params.id);
    if (!lidarrId) {
      return next({ status: '404', message: 'Settings instance not found' });
    }

    const lidarrIndex = settings.lidarr.findIndex(
      (r) => r.id === lidarrId
    );

    if (lidarrIndex === -1) {
      return next({ status: '404', message: 'Settings instance not found' });
    }

    const parsedLidarr = parseLidarrSettings(
      preserveRedactedSecrets(
        req.body,
        settings.lidarr[lidarrIndex]
      ) as Partial<LidarrSettings>,
      settings.lidarr[lidarrIndex]
    );

    if ('error' in parsedLidarr) {
      return next({ status: 400, message: parsedLidarr.error });
    }

    if (parsedLidarr.value.isDefault) {
      settings.lidarr = settings.lidarr.map((lidarr) => ({
        ...lidarr,
        isDefault: lidarr.id === lidarrId,
      }));
    }

    settings.lidarr[lidarrIndex] = {
      ...parsedLidarr.value,
      id: lidarrId,
    } as LidarrSettings;
    await settings.save();

    return res.status(200).json(redactSecrets(settings.lidarr[lidarrIndex]));
  }
);

lidarrRoutes.get<{ id: string }>('/:id/profiles', async (req, res, next) => {
  const settings = getSettings();
  const lidarrId = parsePositiveRouteId(req.params.id);
  if (!lidarrId) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const lidarrSettings = settings.lidarr.find(
    (r) => r.id === lidarrId
  );

  if (!lidarrSettings) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const lidarr = new LidarrAPI({
    apiKey: lidarrSettings.apiKey,
    url: LidarrAPI.buildUrl(lidarrSettings, '/api/v1'),
  });

  const profiles = await lidarr.getProfiles();

  return res.status(200).json(
    profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
    }))
  );
});

lidarrRoutes.delete<{ id: string }>('/:id', async (req, res, next) => {
  const settings = getSettings();
  const lidarrId = parsePositiveRouteId(req.params.id);
  if (!lidarrId) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const lidarrIndex = settings.lidarr.findIndex(
    (r) => r.id === lidarrId
  );

  if (lidarrIndex === -1) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const [removed] = settings.lidarr.splice(lidarrIndex, 1);

  if (removed.isDefault && settings.lidarr.length > 0) {
    settings.lidarr[0].isDefault = true;
  }

  await settings.save();

  return res.status(200).json(redactSecrets(removed));
});

export default lidarrRoutes;
