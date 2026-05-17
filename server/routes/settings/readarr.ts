import ReadarrAPI from '@server/api/servarr/readarr';
import type { ReadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import { preserveRedactedSecrets, redactSecrets } from '@server/utils/security';
import { parseReadarrSettings } from '@server/utils/servarrSettings';
import { Router } from 'express';

const readarrRoutes = Router();

readarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.readarr));
});

readarrRoutes.post('/', async (req, res) => {
  const settings = getSettings();

  const parsedReadarr = parseReadarrSettings(
    preserveRedactedSecrets(req.body, undefined) as Partial<ReadarrSettings>
  );

  if ('error' in parsedReadarr) {
    return res.status(400).json({ message: parsedReadarr.error });
  }

  const newReadarr = parsedReadarr.value;
  const lastItem = settings.readarr[settings.readarr.length - 1];
  newReadarr.id = lastItem ? lastItem.id + 1 : 0;

  if (newReadarr.isDefault) {
    const serviceType = newReadarr.serviceType ?? 'ebook';
    settings.readarr = settings.readarr.map((readarr) => ({
      ...readarr,
      isDefault:
        (readarr.serviceType ?? 'ebook') === serviceType
          ? false
          : readarr.isDefault,
    }));
  }

  settings.readarr = [...settings.readarr, newReadarr];
  await settings.save();

  return res.status(201).json(redactSecrets(newReadarr));
});

readarrRoutes.post<
  undefined,
  Record<string, unknown>,
  ReadarrSettings & { tagLabel?: string }
>('/test', async (req, res, next) => {
  try {
    const parsedReadarr = parseReadarrSettings(req.body);

    if ('error' in parsedReadarr) {
      return res.status(400).json({ message: parsedReadarr.error });
    }

    const readarr = new ReadarrAPI({
      apiKey: parsedReadarr.value.apiKey,
      url: ReadarrAPI.buildUrl(parsedReadarr.value, '/api/v1'),
    });

    const urlBase = await readarr
      .getSystemStatus()
      .then((value) => value.urlBase)
      .catch(() => parsedReadarr.value.baseUrl);
    const profiles = await readarr.getProfiles();
    const metadataProfiles = await readarr.getMetadataProfiles();
    const folders = await readarr.getRootFolders();
    const tags = await readarr.getTags();

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
    logger.error('Failed to test Readarr', {
      label: 'Readarr',
      message: e.message,
    });
    next({ status: 500, message: 'Failed to connect to Bookshelf' });
  }
});

readarrRoutes.put<{ id: string }, ReadarrSettings, ReadarrSettings>(
  '/:id',
  async (req, res, next) => {
    const settings = getSettings();
    const readarrId = parseNonNegativeRouteId(req.params.id);
    if (readarrId === undefined) {
      return next({ status: '404', message: 'Settings instance not found' });
    }

    const readarrIndex = settings.readarr.findIndex((r) => r.id === readarrId);

    if (readarrIndex === -1) {
      return next({ status: '404', message: 'Settings instance not found' });
    }

    const parsedReadarr = parseReadarrSettings(
      preserveRedactedSecrets(
        req.body,
        settings.readarr[readarrIndex]
      ) as Partial<ReadarrSettings>,
      settings.readarr[readarrIndex]
    );

    if ('error' in parsedReadarr) {
      return next({ status: 400, message: parsedReadarr.error });
    }

    if (parsedReadarr.value.isDefault) {
      const serviceType = parsedReadarr.value.serviceType ?? 'ebook';
      settings.readarr = settings.readarr.map((readarr) => ({
        ...readarr,
        isDefault:
          (readarr.serviceType ?? 'ebook') === serviceType
            ? readarr.id === readarrId
            : readarr.isDefault,
      }));
    }

    settings.readarr[readarrIndex] = {
      ...parsedReadarr.value,
      id: readarrId,
    } as ReadarrSettings;
    await settings.save();

    return res.status(200).json(redactSecrets(settings.readarr[readarrIndex]));
  }
);

readarrRoutes.delete<{ id: string }>('/:id', async (req, res, next) => {
  const settings = getSettings();
  const readarrId = parseNonNegativeRouteId(req.params.id);
  if (readarrId === undefined) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const readarrIndex = settings.readarr.findIndex((r) => r.id === readarrId);

  if (readarrIndex === -1) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const [removed] = settings.readarr.splice(readarrIndex, 1);

  if (removed.isDefault) {
    const removedServiceType = removed.serviceType ?? 'ebook';
    const nextDefault = settings.readarr.find(
      (readarr) => (readarr.serviceType ?? 'ebook') === removedServiceType
    );

    if (nextDefault) {
      nextDefault.isDefault = true;
    }
  }

  await settings.save();

  return res.status(200).json(redactSecrets(removed));
});

export default readarrRoutes;
