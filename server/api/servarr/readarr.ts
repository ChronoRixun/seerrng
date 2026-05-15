import ServarrBase from './base';

export interface ReadarrMetadataProfile {
  id: number;
  name: string;
}

export interface ReadarrBookLookupResult {
  id?: number;
  title: string;
  foreignBookId: string;
  foreignEditionId?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolderPath?: string;
  monitored?: boolean;
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

class ReadarrAPI extends ServarrBase<Record<string, unknown>> {
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
