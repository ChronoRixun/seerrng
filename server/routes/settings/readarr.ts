import ReadarrAPI from '@server/api/servarr/readarr';
import type { ReadarrBookLookupResult } from '@server/api/servarr/readarr';
import type { ReadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import { preserveRedactedSecrets, redactSecrets } from '@server/utils/security';
import { parseReadarrSettings } from '@server/utils/servarrSettings';
import { Router } from 'express';

const readarrRoutes = Router();

const isAddableBookLookupResult = (
  result: ReadarrBookLookupResult
): boolean =>
  !!(
    result.foreignBookId &&
    result.title &&
    result.author?.foreignAuthorId &&
    Array.isArray(result.editions) &&
    result.editions.length > 0
  );

const parseAuthorName = (
  result: ReadarrBookLookupResult
): string | undefined => {
  const authorTitle = result.authorTitle?.trim();

  if (!authorTitle) {
    return undefined;
  }

  const titleIndex = authorTitle
    .toLocaleLowerCase()
    .lastIndexOf(result.title.toLocaleLowerCase());
  const rawAuthorName =
    titleIndex > 0 ? authorTitle.slice(0, titleIndex).trim() : authorTitle;
  const [lastName, ...firstNameParts] = rawAuthorName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!lastName) {
    return undefined;
  }

  return firstNameParts.length
    ? `${firstNameParts.join(' ')} ${lastName}`
    : lastName;
};

const hydrateSoftcoverResult = async (
  readarr: ReadarrAPI,
  result: ReadarrBookLookupResult
): Promise<ReadarrBookLookupResult> => {
  if (isAddableBookLookupResult(result)) {
    return result;
  }

  if (result.author || !result.foreignEditionId) {
    return result;
  }

  const authorName = parseAuthorName(result);

  if (!authorName) {
    return result;
  }

  const [author] = await readarr.lookupAuthor(authorName);

  if (!author?.foreignAuthorId || !author.authorName) {
    return result;
  }

  return {
    ...result,
    author: {
      foreignAuthorId: author.foreignAuthorId,
      authorName: author.authorName,
    },
    editions: [
      {
        foreignEditionId: result.foreignEditionId,
        title: result.title,
        monitored: true,
      },
    ],
  };
};

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

readarrRoutes.post<
  undefined,
  Record<string, unknown>,
  Partial<ReadarrSettings> & {
    term?: unknown;
    testAdd?: unknown;
  }
>('/diagnose', async (req, res) => {
  const parsedReadarr = parseReadarrSettings(req.body);

  if ('error' in parsedReadarr) {
    return res.status(400).json({
      ok: false,
      category: 'backend_unreachable',
      message: parsedReadarr.error,
    });
  }

  const term =
    typeof req.body.term === 'string' && req.body.term.trim()
      ? req.body.term.trim()
      : 'isbn:9780547928227';
  const testAdd = req.body.testAdd === true;
  const readarr = new ReadarrAPI({
    apiKey: parsedReadarr.value.apiKey,
    url: ReadarrAPI.buildUrl(parsedReadarr.value, '/api/v1'),
  });

  try {
    const [status, development, profiles, metadataProfiles, folders] =
      await Promise.all([
        readarr.getSystemStatus(),
        readarr.getDevelopmentConfig().catch(() => undefined),
        readarr.getProfiles(),
        readarr.getMetadataProfiles(),
        readarr.getRootFolders(),
      ]);
    const lookup = await readarr.lookupBook(term);

    if (!lookup.length) {
      return res.status(200).json({
        ok: false,
        category: 'lookup_empty',
        message: 'Bookshelf lookup returned no results.',
        term,
        system: {
          appName: status.appName,
          version: status.version,
          urlBase: status.urlBase,
        },
        metadataSource: development?.metadataSource,
        profiles: profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
        })),
        metadataProfiles: metadataProfiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
        })),
        rootFolders: folders.map((folder) => ({
          id: folder.id,
          path: folder.path,
          accessible: folder.accessible,
        })),
        lookupCount: 0,
      });
    }

    const hydratedLookup = await Promise.all(
      lookup.map((result) => hydrateSoftcoverResult(readarr, result))
    );
    const addableResult = hydratedLookup.find(isAddableBookLookupResult);

    if (!addableResult) {
      return res.status(200).json({
        ok: false,
        category: 'lookup_incomplete',
        message:
          'Bookshelf lookup returned results, but none had usable author and edition metadata.',
        term,
        metadataSource: development?.metadataSource,
        lookupCount: lookup.length,
        sample: lookup.slice(0, 3).map((result) => ({
          title: result.title,
          foreignBookId: result.foreignBookId,
          foreignEditionId: result.foreignEditionId,
          authorPresent: !!result.author,
          editionCount: result.editions?.length ?? 0,
        })),
      });
    }

    if (testAdd) {
      try {
        const rootFolder =
          parsedReadarr.value.activeDirectory || folders[0]?.path;
        const qualityProfileId =
          parsedReadarr.value.activeProfileId || profiles[0]?.id;
        const metadataProfileId =
          parsedReadarr.value.activeMetadataProfileId ||
          metadataProfiles[0]?.id ||
          1;

        const added = await readarr.addBook({
          ...addableResult,
          monitored: true,
          qualityProfileId,
          metadataProfileId,
          rootFolderPath: rootFolder,
          tags: parsedReadarr.value.tags ?? [],
          author: {
            ...addableResult.author,
            rootFolderPath: rootFolder,
            qualityProfileId,
            metadataProfileId,
            monitored: true,
            addOptions: {
              monitor: 'none',
              searchForMissingBooks: false,
            },
            manualAdd: true,
          },
          editions: addableResult.editions ?? [],
          addOptions: {
            searchForNewBook: false,
          },
        });

        if (added.id) {
          await readarr
            .removeBook(added.id, {
              deleteFiles: false,
              addImportListExclusion: false,
            })
            .catch(() => undefined);
        }
      } catch (e) {
        return res.status(200).json({
          ok: false,
          category: 'backend_add_rejected',
          message: e instanceof Error ? e.message : String(e),
          term,
          lookupCount: lookup.length,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      category: 'ok',
      message: 'Bookshelf lookup returned usable metadata.',
      term,
      metadataSource: development?.metadataSource,
      lookupCount: lookup.length,
      sample: {
        title: addableResult.title,
        foreignBookId: addableResult.foreignBookId,
        authorName: addableResult.author?.authorName,
        editionCount: addableResult.editions?.length ?? 0,
      },
    });
  } catch (e) {
    logger.error('Failed to diagnose Bookshelf', {
      label: 'Readarr',
      message: e instanceof Error ? e.message : String(e),
    });

    return res.status(200).json({
      ok: false,
      category: 'backend_unreachable',
      message: e instanceof Error ? e.message : String(e),
      term,
    });
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
