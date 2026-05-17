import SonarrAPI from '@server/api/servarr/sonarr';
import type { SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import { preserveRedactedSecrets, redactSecrets } from '@server/utils/security';
import { parseSonarrSettings } from '@server/utils/servarrSettings';
import { Router } from 'express';

const sonarrRoutes = Router();

sonarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.sonarr));
});

sonarrRoutes.post('/', async (req, res) => {
  const settings = getSettings();

  const parsedSonarr = parseSonarrSettings(
    preserveRedactedSecrets(req.body, undefined) as Partial<SonarrSettings>
  );

  if ('error' in parsedSonarr) {
    return res.status(400).json({ message: parsedSonarr.error });
  }

  const newSonarr = parsedSonarr.value;
  const lastItem = settings.sonarr[settings.sonarr.length - 1];
  newSonarr.id = lastItem ? lastItem.id + 1 : 0;

  // If we are setting this as the default, clear any previous defaults for the same type first
  // ex: if is4k is true, it will only remove defaults for other servers that have is4k set to true
  // and are the default
  if (newSonarr.isDefault) {
    settings.sonarr
      .filter((sonarrInstance) => sonarrInstance.is4k === newSonarr.is4k)
      .forEach((sonarrInstance) => {
        sonarrInstance.isDefault = false;
      });
  }

  settings.sonarr = [...settings.sonarr, newSonarr];
  await settings.save();

  return res.status(201).json(redactSecrets(newSonarr));
});

sonarrRoutes.post('/test', async (req, res, next) => {
  try {
    const parsedSonarr = parseSonarrSettings(req.body);

    if ('error' in parsedSonarr) {
      return res.status(400).json({ message: parsedSonarr.error });
    }

    const sonarr = new SonarrAPI({
      apiKey: parsedSonarr.value.apiKey,
      url: SonarrAPI.buildUrl(parsedSonarr.value, '/api/v3'),
    });

    const systemStatus = await sonarr.getSystemStatus();
    const sonarrMajorVersion = Number(systemStatus.version.split('.')[0]);

    const urlBase = systemStatus.urlBase;
    const profiles = await sonarr.getProfiles();
    const folders = await sonarr.getRootFolders();
    const languageProfiles =
      sonarrMajorVersion <= 3 ? await sonarr.getLanguageProfiles() : null;
    const tags = await sonarr.getTags();

    return res.status(200).json({
      profiles,
      rootFolders: folders.map((folder) => ({
        id: folder.id,
        path: folder.path,
      })),
      languageProfiles,
      tags,
      urlBase,
    });
  } catch (e) {
    logger.error('Failed to test Sonarr', {
      label: 'Sonarr',
      message: e.message,
    });

    next({ status: 500, message: 'Failed to connect to Sonarr' });
  }
});

sonarrRoutes.put<{ id: string }>('/:id', async (req, res) => {
  const settings = getSettings();
  const sonarrId = parseNonNegativeRouteId(req.params.id);
  if (sonarrId === undefined) {
    return res
      .status(404)
      .json({ status: '404', message: 'Settings instance not found' });
  }

  const sonarrIndex = settings.sonarr.findIndex((r) => r.id === sonarrId);

  if (sonarrIndex === -1) {
    return res
      .status(404)
      .json({ status: '404', message: 'Settings instance not found' });
  }

  // If we are setting this as the default, clear any previous defaults for the same type first
  // ex: if is4k is true, it will only remove defaults for other servers that have is4k set to true
  // and are the default
  const parsedSonarr = parseSonarrSettings(
    preserveRedactedSecrets(
      req.body,
      settings.sonarr[sonarrIndex]
    ) as Partial<SonarrSettings>,
    settings.sonarr[sonarrIndex]
  );

  if ('error' in parsedSonarr) {
    return res.status(400).json({ message: parsedSonarr.error });
  }

  if (parsedSonarr.value.isDefault) {
    settings.sonarr
      .filter(
        (sonarrInstance) => sonarrInstance.is4k === parsedSonarr.value.is4k
      )
      .forEach((sonarrInstance) => {
        sonarrInstance.isDefault = false;
      });
  }

  settings.sonarr[sonarrIndex] = {
    ...parsedSonarr.value,
    id: sonarrId,
  } as SonarrSettings;
  await settings.save();

  return res.status(200).json(redactSecrets(settings.sonarr[sonarrIndex]));
});

sonarrRoutes.delete<{ id: string }>('/:id', async (req, res) => {
  const settings = getSettings();
  const sonarrId = parseNonNegativeRouteId(req.params.id);
  if (sonarrId === undefined) {
    return res
      .status(404)
      .json({ status: '404', message: 'Settings instance not found' });
  }

  const sonarrIndex = settings.sonarr.findIndex((r) => r.id === sonarrId);

  if (sonarrIndex === -1) {
    return res
      .status(404)
      .json({ status: '404', message: 'Settings instance not found' });
  }

  const removed = settings.sonarr.splice(sonarrIndex, 1);
  await settings.save();

  return res.status(200).json(redactSecrets(removed[0]));
});

export default sonarrRoutes;
