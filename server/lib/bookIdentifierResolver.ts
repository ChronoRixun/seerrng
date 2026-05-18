import OpenLibraryAPI from '@server/api/openlibrary';
import type { ReadarrBook } from '@server/api/servarr/readarr';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import logger from '@server/logger';

type ResolvedIdentifier = {
  provider: MediaIdentifierProvider;
  value: string;
};

const normalizeOpenLibraryWorkId = (value?: string): string | undefined => {
  const id = value?.replace('/works/', '');
  return id && /^OL\d+W$/i.test(id) ? id : undefined;
};

const normalizeOpenLibraryEditionId = (value?: string): string | undefined => {
  const id = value?.replace('/books/', '');
  return id && /^OL\d+M$/i.test(id) ? id : undefined;
};

const uniqIdentifiers = (
  identifiers: (ResolvedIdentifier | undefined)[]
): ResolvedIdentifier[] => {
  const seen = new Set<string>();
  const unique: ResolvedIdentifier[] = [];

  for (const identifier of identifiers) {
    if (!identifier) {
      continue;
    }

    const key = `${identifier.provider}:${identifier.value}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(identifier);
  }

  return unique;
};

export const resolveOpenLibraryIdentifiersForReadarrBook = async (
  book: ReadarrBook,
  openLibrary = new OpenLibraryAPI()
): Promise<ResolvedIdentifier[]> => {
  const identifiers: (ResolvedIdentifier | undefined)[] = [];
  const workId = normalizeOpenLibraryWorkId(book.foreignBookId);

  if (workId) {
    identifiers.push({
      provider: MediaIdentifierProvider.OPENLIBRARY,
      value: workId,
    });
  }

  const editionIds = [
    ...new Set(
      (book.editions ?? [])
        .map((edition) =>
          normalizeOpenLibraryEditionId(edition.foreignEditionId)
        )
        .filter((editionId): editionId is string => !!editionId)
    ),
  ];

  editionIds.forEach((editionId) => {
    identifiers.push({
      provider: MediaIdentifierProvider.OPENLIBRARY_EDITION,
      value: editionId,
    });
  });

  for (const editionId of editionIds) {
    try {
      const edition = await openLibrary.getEdition(editionId);
      const editionWorkId = normalizeOpenLibraryWorkId(edition.works?.[0]?.key);

      if (editionWorkId) {
        identifiers.push({
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: editionWorkId,
        });
      }
    } catch (e) {
      logger.debug('Unable to resolve Open Library edition for book scan', {
        label: 'Bookshelf Scan',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return uniqIdentifiers(identifiers);
};
