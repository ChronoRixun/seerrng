import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';

export interface OpenLibrarySearchDoc {
  key: string;
  title: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  edition_key?: string[];
}

interface OpenLibrarySearchResponse {
  numFound: number;
  start: number;
  docs: OpenLibrarySearchDoc[];
}

export interface OpenLibraryWork {
  key: string;
  title: string;
  description?: string | { value: string };
  covers?: number[];
  authors?: {
    author: {
      key: string;
    };
  }[];
  first_publish_date?: string;
  subjects?: string[];
}

class OpenLibraryAPI extends ExternalAPI {
  constructor() {
    super(
      'https://openlibrary.org',
      {},
      {
        nodeCache: cacheManager.getCache('openlibrary').data,
        rateLimit: {
          maxRequests: 10,
          maxRPS: 5,
        },
      }
    );
  }

  public async searchBooks({
    query,
    page = 1,
    limit = 20,
  }: {
    query: string;
    page?: number;
    limit?: number;
  }): Promise<OpenLibrarySearchResponse> {
    return this.get<OpenLibrarySearchResponse>(
      '/search.json',
      {
        params: {
          q: query,
          page: page.toString(),
          limit: limit.toString(),
        },
      },
      43200
    );
  }

  public async getWork(workId: string): Promise<OpenLibraryWork> {
    const normalizedWorkId = workId.startsWith('/works/')
      ? workId
      : `/works/${workId}`;

    return this.get<OpenLibraryWork>(`${normalizedWorkId}.json`, undefined, 43200);
  }
}

export default OpenLibraryAPI;
