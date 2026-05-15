import ServarrBase from './base';

export interface ReadarrMetadataProfile {
  id: number;
  name: string;
}

export interface ReadarrBookLookupResult {
  title: string;
  foreignBookId: string;
  foreignEditionId?: string;
  authorTitle?: string;
  author?: {
    foreignAuthorId?: string;
    authorName?: string;
  };
  editions?: {
    foreignEditionId: string;
    title: string;
    isbn13?: string;
    asin?: string;
    monitored: boolean;
  }[];
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
}

export default ReadarrAPI;
