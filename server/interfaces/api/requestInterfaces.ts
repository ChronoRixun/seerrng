import type { MediaType } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties, PaginatedResponse } from './common';

export interface RequestResultsResponse extends PaginatedResponse {
  results: (NonFunctionProperties<MediaRequest> & {
    profileName?: string;
    canRemove?: boolean;
  })[];
  serviceErrors: {
    radarr: { id: number; name: string }[];
    sonarr: { id: number; name: string }[];
    lidarr: { id: number; name: string }[];
    readarr: { id: number; name: string }[];
  };
}

export type MediaRequestBody = {
  mediaType: MediaType;
  mediaId: number | string;
  tvdbId?: number;
  seasons?: number[] | 'all';
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  profileName?: string;
  rootFolder?: string;
  languageProfileId?: number;
  metadataProfileId?: number;
  format?: 'ebook' | 'audiobook' | 'both';
  editionId?: string;
  isbn13?: string;
  authorId?: string;
  userId?: number;
  tags?: number[];
};

export type BulkMediaRequestItem = {
  mediaId: string;
  title?: string;
  isbn13?: string;
  editionId?: string;
  authorId?: string;
};

export type BulkMediaRequestBody = {
  mediaType: MediaType.MUSIC | MediaType.BOOK;
  items: BulkMediaRequestItem[];
  format?: 'ebook' | 'audiobook' | 'both';
  serverId?: number;
  profileId?: number;
  profileName?: string;
  rootFolder?: string;
  metadataProfileId?: number;
  userId?: number;
  tags?: number[];
};

export type BulkMediaRequestResult = {
  mediaId: string;
  title?: string;
  reason: string;
};

export type BulkMediaRequestResponse = {
  created: MediaRequest[];
  skipped: BulkMediaRequestResult[];
  failed: BulkMediaRequestResult[];
};
