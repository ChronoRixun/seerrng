import ExternalAPI from '@server/api/externalapi';
import type { AvailableCacheIds } from '@server/lib/cache';
import cacheManager from '@server/lib/cache';
import { getSettings, type DVRSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { buildServiceUrl } from '@server/utils/serviceUrl';

export interface SystemStatus {
  appName?: string;
  version: string;
  buildTime: Date;
  isDebug: boolean;
  isProduction: boolean;
  isAdmin: boolean;
  isUserInteractive: boolean;
  startupPath: string;
  appData: string;
  osName: string;
  osVersion: string;
  isNetCore: boolean;
  isMono: boolean;
  isLinux: boolean;
  isOsx: boolean;
  isWindows: boolean;
  isDocker: boolean;
  mode: string;
  branch: string;
  authentication: string;
  sqliteVersion: string;
  migrationVersion: number;
  urlBase: string;
  runtimeVersion: string;
  runtimeName: string;
  startTime: Date;
  packageUpdateMechanism: string;
}

export interface RootFolder {
  id: number;
  path: string;
  freeSpace: number;
  totalSpace: number;
  accessible?: boolean;
  unmappedFolders: {
    name: string;
    path: string;
  }[];
}

export interface QualityProfile {
  id: number;
  name: string;
}

interface QueueItem {
  size: number;
  title: string;
  sizeleft: number;
  timeleft: string;
  estimatedCompletionTime: string;
  status: string;
  trackedDownloadStatus: string;
  trackedDownloadState: string;
  downloadId: string;
  protocol: string;
  downloadClient: string;
  indexer: string;
  id: number;
}

export interface Tag {
  id: number;
  label: string;
}

interface QueueResponse<QueueItemAppendT> {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: (QueueItem & QueueItemAppendT)[];
}

const EXTERNAL_READ_ONLY =
  process.env.SEERR_EXTERNAL_READ_ONLY?.toLowerCase() === 'true' ||
  process.env.SEERR_EXTERNAL_READ_ONLY === '1';

const normalizeConfiguredServiceUrl = (value: string, apiName: string) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      throw new Error('Service URL must be HTTP or HTTPS.');
    }

    url.username = '';
    url.password = '';
    return url.toString().replace(/\/+$/, '');
  } catch (e) {
    throw new Error(`[${apiName}] Invalid configured service URL`, {
      cause: e,
    });
  }
};

class ServarrBase<QueueItemAppendT> extends ExternalAPI {
  static buildUrl(settings: DVRSettings, path?: string): string {
    return buildServiceUrl({
      useSsl: settings.useSsl,
      hostname: settings.hostname,
      port: settings.port,
      urlBase: settings.baseUrl,
      path,
    });
  }

  protected apiName: string;

  constructor({
    url,
    apiKey,
    cacheName,
    apiName,
  }: {
    url: string;
    apiKey: string;
    cacheName: AvailableCacheIds;
    apiName: string;
  }) {
    const timeout = getSettings().network.apiRequestTimeout;
    const normalizedUrl = normalizeConfiguredServiceUrl(url, apiName);

    super(
      normalizedUrl,
      {
        apikey: apiKey,
      },
      {
        nodeCache: cacheManager.getCache(cacheName).data,
        timeout,
      }
    );

    this.apiName = apiName;

    if (EXTERNAL_READ_ONLY) {
      this.axios.interceptors.request.use((config) => {
        const method = (config.method ?? 'get').toUpperCase();

        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          logger.warn('Blocked mutating Servarr request in read-only mode.', {
            label: this.apiName,
            method,
            url: config.url,
          });

          throw new Error(
            `[${this.apiName}] Mutating API request blocked by SEERR_EXTERNAL_READ_ONLY`
          );
        }

        return config;
      });
    }
  }

  public async getSystemStatus(): Promise<SystemStatus> {
    try {
      const response = await this.axios.get<SystemStatus>('/system/status');

      return response.data;
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve system status: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getProfiles(): Promise<QualityProfile[]> {
    try {
      const data = await this.getRolling<QualityProfile[]>(
        `/qualityProfile`,
        undefined,
        3600
      );

      return data;
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve profiles: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getRootFolders(): Promise<RootFolder[]> {
    try {
      const data = await this.getRolling<RootFolder[]>(
        `/rootfolder`,
        undefined,
        3600
      );

      return data;
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve root folders: ${e.message}`,
        { cause: e }
      );
    }
  }

  public getQueue = async (): Promise<(QueueItem & QueueItemAppendT)[]> => {
    try {
      const response = await this.axios.get<QueueResponse<QueueItemAppendT>>(
        `/queue`,
        {
          params: {
            includeEpisode: true,
          },
        }
      );

      return response.data.records;
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve queue: ${e.message}`,
        { cause: e }
      );
    }
  };

  public getTags = async (): Promise<Tag[]> => {
    try {
      const response = await this.axios.get<Tag[]>(`/tag`);

      return response.data;
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve tags: ${e.message}`,
        { cause: e }
      );
    }
  };

  public createTag = async ({ label }: { label: string }): Promise<Tag> => {
    try {
      const response = await this.axios.post<Tag>(`/tag`, {
        label,
      });

      return response.data;
    } catch (e) {
      throw new Error(`[${this.apiName}] Failed to create tag: ${e.message}`, {
        cause: e,
      });
    }
  };

  public renameTag = async ({
    id,
    label,
  }: {
    id: number;
    label: string;
  }): Promise<Tag> => {
    try {
      const response = await this.axios.put<Tag>(`/tag/${id}`, {
        id,
        label,
      });

      return response.data;
    } catch (e) {
      throw new Error(`[${this.apiName}] Failed to rename tag: ${e.message}`, {
        cause: e,
      });
    }
  };

  async refreshMonitoredDownloads(): Promise<void> {
    if (EXTERNAL_READ_ONLY) {
      logger.debug('Skipping monitored download refresh in read-only mode.', {
        label: this.apiName,
      });

      return;
    }

    await this.runCommand('RefreshMonitoredDownloads', {});
  }

  protected async runCommand(
    commandName: string,
    options: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.axios.post(`/command`, {
        name: commandName,
        ...options,
      });
    } catch (e) {
      throw new Error(`[${this.apiName}] Failed to run command: ${e.message}`, {
        cause: e,
      });
    }
  }
}

export default ServarrBase;
