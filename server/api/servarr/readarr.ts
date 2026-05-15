import logger from '@server/logger';
import ServarrBase from './base';

export interface ReadarrMetadataProfile {
  id: number;
  name: string;
}

export interface ReadarrBookLookupResult {
  id?: number;
  title: string;
  titleSlug?: string;
  foreignBookId: string;
  foreignEditionId?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolderPath?: string;
  monitored?: boolean;
  tags?: number[];
  authorTitle?: string;
  author?: {
    foreignAuthorId?: string;
    authorName?: string;
    id?: number;
  };
  editions?: {
    foreignEditionId: string;
    title: string;
    isbn13?: string;
    asin?: string;
    monitored: boolean;
  }[];
}

export interface ReadarrBookOptions extends ReadarrBookLookupResult {
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath: string;
  monitored: boolean;
  tags?: number[];
  addOptions?: {
    searchForNewBook: boolean;
  };
}

export interface ReadarrBook extends ReadarrBookLookupResult {
  id: number;
  titleSlug?: string;
  added?: string;
  statistics?: {
    bookFileCount?: number;
    totalBookCount?: number;
  };
}

type ReadarrQueueItem = {
  bookId?: number;
  book?: {
    id?: number;
  };
};

const normalizeIsbn = (isbn?: string): string | undefined =>
  isbn?.replace(/[^0-9X]/gi, '').toUpperCase();

class ReadarrAPI extends ServarrBase<ReadarrQueueItem> {
  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({
      url,
      apiKey,
      cacheName: 'readarr',
      apiName: 'Readarr',
    });
  }

  public async getMetadataProfiles(): Promise<ReadarrMetadataProfile[]> {
    try {
      return await this.get<ReadarrMetadataProfile[]>('/metadataProfile');
    } catch (e) {
      throw new Error(
        `[Readarr] Failed to retrieve metadata profiles: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getBooks(): Promise<ReadarrBook[]> {
    try {
      return await this.get<ReadarrBook[]>('/book');
    } catch (e) {
      throw new Error(`[Readarr] Failed to retrieve books: ${e.message}`);
    }
  }

  public async lookupBook(term: string): Promise<ReadarrBookLookupResult[]> {
    try {
      return await this.get<ReadarrBookLookupResult[]>('/book/lookup', {
        params: { term },
      });
    } catch (e) {
      throw new Error(`[Readarr] Failed to lookup book: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async addBook(options: ReadarrBookOptions): Promise<ReadarrBookLookupResult> {
    try {
      const existingBooks = await this.get<ReadarrBook[]>('/book');
      const optionEditionIds = new Set(
        options.editions
          ?.map((edition) => edition.foreignEditionId)
          .filter(Boolean)
      );
      const optionIsbns = new Set(
        options.editions
          ?.map((edition) => normalizeIsbn(edition.isbn13))
          .filter(Boolean)
      );
      const existingBook = existingBooks.find((book) => {
        if (
          book.foreignBookId &&
          options.foreignBookId &&
          book.foreignBookId === options.foreignBookId
        ) {
          return true;
        }

        return book.editions?.some((edition) => {
          const editionIsbn = normalizeIsbn(edition.isbn13);

          return (
            (!!edition.foreignEditionId &&
              optionEditionIds.has(edition.foreignEditionId)) ||
            (!!editionIsbn && optionIsbns.has(editionIsbn))
          );
        });
      });

      if (existingBook?.monitored) {
        logger.info(
          'Book is already monitored in Bookshelf/Readarr. Skipping add and returning success',
          {
            label: 'Readarr',
            bookId: existingBook.id,
            bookTitle: existingBook.title,
          }
        );
        return existingBook;
      }

      if (existingBook) {
        logger.info(
          'Book exists in Bookshelf/Readarr but is not monitored. Updating monitored status.',
          {
            label: 'Readarr',
            bookId: existingBook.id,
            bookTitle: existingBook.title,
          }
        );

        const updatedBook = await this.axios.put<ReadarrBook>(
          `/book/${existingBook.id}`,
          {
            ...existingBook,
            monitored: true,
            qualityProfileId:
              options.qualityProfileId ?? existingBook.qualityProfileId,
            metadataProfileId:
              options.metadataProfileId ?? existingBook.metadataProfileId,
            rootFolderPath: options.rootFolderPath ?? existingBook.rootFolderPath,
            tags: options.tags ?? existingBook.tags,
          }
        );

        await this.post('/command', {
          name: 'BookSearch',
          bookIds: [updatedBook.data.id],
        });

        return updatedBook.data;
      }

      return await this.post<ReadarrBookLookupResult>(
        '/book',
        options as unknown as Record<string, unknown>
      );
    } catch (e) {
      throw new Error(`[Readarr] Failed to add book: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async removeBook(bookId: number): Promise<void> {
    try {
      await this.axios.delete(`/book/${bookId}`, {
        params: {
          deleteFiles: true,
          addImportListExclusion: false,
        },
      });
    } catch (e) {
      throw new Error(`[Readarr] Failed to remove book: ${e.message}`);
    }
  }
}

export default ReadarrAPI;
