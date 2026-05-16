import type {
  OpenLibraryEdition,
  OpenLibrarySearchDoc,
  OpenLibraryWork,
} from '@server/api/openlibrary';
import type Media from '@server/entity/Media';
import { normalizeValidIsbn } from '@server/lib/isbn';

export interface BookResult {
  id: string;
  mediaType: 'book';
  title: string;
  author?: string;
  authorId?: string;
  firstPublishYear?: number;
  posterPath?: string;
  isbn13?: string;
  editionId?: string;
  isbnCandidates?: BookIsbnCandidate[];
  mediaInfo?: Media;
}

export interface BookDetails extends BookResult {
  description?: string;
  subjects?: string[];
  onUserWatchlist?: boolean;
}

export interface BookIsbnCandidate {
  isbn: string;
  editionId?: string;
  title?: string;
  format?: string;
}

const getEditionId = (key?: string): string | undefined =>
  key?.replace('/books/', '');

const mapEditionIsbnCandidates = (
  editions: OpenLibraryEdition[]
): BookIsbnCandidate[] => {
  const candidates = new Map<string, BookIsbnCandidate>();

  editions.forEach((edition) => {
    const editionId = getEditionId(edition.key);
    const title = edition.title;
    const format = edition.physical_format;

    [...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])].forEach((isbn) => {
      const normalized = normalizeValidIsbn(isbn);

      if (normalized && !candidates.has(normalized)) {
        candidates.set(normalized, {
          isbn: normalized,
          editionId,
          title,
          format,
        });
      }
    });
  });

  return [...candidates.values()].sort((a, b) => {
    if (a.isbn.length !== b.isbn.length) {
      return b.isbn.length - a.isbn.length;
    }

    return a.isbn.localeCompare(b.isbn);
  });
};

export const mapOpenLibrarySearchDoc = (
  doc: OpenLibrarySearchDoc,
  media?: Media
): BookResult => {
  const isbn13 = doc.isbn
    ?.map((isbn) => normalizeValidIsbn(isbn))
    .find((isbn): isbn is string => !!isbn);
  const workId = doc.key.replace('/works/', '');

  return {
    id: workId,
    mediaType: 'book',
    title: doc.title,
    author: doc.author_name?.[0],
    authorId: doc.author_key?.[0],
    firstPublishYear: doc.first_publish_year,
    posterPath: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : undefined,
    isbn13,
    editionId: doc.edition_key?.[0],
    mediaInfo: media,
  };
};

export const mapOpenLibraryWork = (
  work: OpenLibraryWork,
  media?: Media,
  editions: OpenLibraryEdition[] = [],
  userWatchlist?: boolean,
  authorName?: string
): BookDetails => {
  const description =
    typeof work.description === 'string'
      ? work.description
      : work.description?.value;
  const coverId = work.covers?.[0];
  const isbnCandidates = mapEditionIsbnCandidates(editions);
  const selectedCandidate = isbnCandidates[0];

  return {
    id: work.key.replace('/works/', ''),
    mediaType: 'book',
    title: work.title,
    author: authorName,
    authorId: work.authors?.[0]?.author.key.replace('/authors/', ''),
    firstPublishYear: work.first_publish_date
      ? Number(work.first_publish_date.match(/\d{4}/)?.[0])
      : undefined,
    posterPath: coverId
      ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
      : undefined,
    isbn13: selectedCandidate?.isbn,
    editionId: selectedCandidate?.editionId,
    isbnCandidates,
    description,
    subjects: work.subjects?.slice(0, 20),
    mediaInfo: media,
    onUserWatchlist: userWatchlist,
  };
};
