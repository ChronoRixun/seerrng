import ReadarrAPI from '@server/api/servarr/readarr';
import type { ReadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const readarrRoutes = Router();

readarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.readarr);
});

readarrRoutes.post('/', (req, res) => {
  const settings = getSettings();

  const newReadarr = req.body as ReadarrSettings;
  const lastItem = settings.readarr[settings.readarr.length - 1];
  newReadarr.id = lastItem ? lastItem.id + 1 : 0;

  if (newReadarr.isDefault) {
    settings.readarr = settings.readarr.map((readarr) => ({
      ...readarr,
      isDefault: false,
    }));
  }

  settings.readarr = [...settings.readarr, newReadarr];
  settings.save();

  return res.status(201).json(newReadarr);
});

readarrRoutes.post<
  undefined,
  Record<string, unknown>,
  ReadarrSettings & { tagLabel?: string }
>('/test', async (req, res, next) => {
  try {
    const readarr = new ReadarrAPI({
      apiKey: req.body.apiKey,
      url: ReadarrAPI.buildUrl(req.body, '/api/v1'),
    });

    const urlBase = await readarr
      .getSystemStatus()
      .then((value) => value.urlBase)
      .catch(() => req.body.baseUrl);
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
  (req, res, next) => {
    const settings = getSettings();

    const readarrIndex = settings.readarr.findIndex(
      (r) => r.id === Number(req.params.id)
    );

    if (readarrIndex === -1) {
      return next({ status: '404', message: 'Settings instance not found' });
    }

    if (req.body.isDefault) {
      settings.readarr = settings.readarr.map((readarr) => ({
        ...readarr,
        isDefault: readarr.id === Number(req.params.id),
      }));
    }

    settings.readarr[readarrIndex] = {
      ...req.body,
      id: Number(req.params.id),
    } as ReadarrSettings;
    settings.save();

    return res.status(200).json(settings.readarr[readarrIndex]);
  }
);

readarrRoutes.delete<{ id: string }>('/:id', (req, res, next) => {
  const settings = getSettings();

  const readarrIndex = settings.readarr.findIndex(
    (r) => r.id === Number(req.params.id)
  );

  if (readarrIndex === -1) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const removed = settings.readarr.splice(readarrIndex, 1);
  settings.save();

  return res.status(200).json(removed[0]);
});

export default readarrRoutes;
