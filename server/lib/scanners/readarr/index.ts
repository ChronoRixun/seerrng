import type { ReadarrBook } from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import type { ReadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { uniqWith } from 'lodash';

type SyncStatus = StatusBase & {
  currentServer: ReadarrSettings;
  servers: ReadarrSettings[];
};

class ReadarrScanner
  extends BaseScanner<ReadarrBook>
  implements RunnableScanner<SyncStatus>
{
  private servers: ReadarrSettings[];
  private currentServer: ReadarrSettings;
  private readarrApi: ReadarrAPI;

  constructor() {
    super('Readarr Scan', { bundleSize: 50 });
  }

  public status(): SyncStatus {
    return {
      running: this.running,
      progress: this.progress,
      total: this.items.length,
      currentServer: this.currentServer,
      servers: this.servers,
    };
  }

  public async run(): Promise<void> {
    const settings = getSettings();
    const sessionId = this.startRun();

    try {
      this.servers = uniqWith(settings.readarr, (readarrA, readarrB) => {
        return (
          readarrA.hostname === readarrB.hostname &&
          readarrA.port === readarrB.port &&
          readarrA.baseUrl === readarrB.baseUrl
        );
      });

      for (const server of this.servers) {
        this.currentServer = server;
        if (server.syncEnabled) {
          this.log(
            `Beginning to process Readarr server: ${server.name}`,
            'info'
          );

          this.readarrApi = new ReadarrAPI({
            apiKey: server.apiKey,
            url: ReadarrAPI.buildUrl(server, '/api/v1'),
          });

          this.items = await this.readarrApi.getBooks();
          await this.loop(this.processReadarrBook.bind(this), { sessionId });
        } else {
          this.log(`Sync not enabled. Skipping Readarr server: ${server.name}`);
        }
      }

      this.log('Readarr scan complete', 'info');
    } catch (e) {
      this.log('Scan interrupted', 'error', { errorMessage: e.message });
    } finally {
      this.endRun(sessionId);
    }
  }

  private async processReadarrBook(readarrBook: ReadarrBook): Promise<void> {
    try {
      if (!readarrBook.monitored) {
        return;
      }

      const identifier =
        readarrBook.editions?.find((edition) => edition.isbn13)?.isbn13 ??
        readarrBook.foreignBookId;

      if (!identifier) {
        this.log('No supported identifier found for this book. Skipping item.', 'debug', {
          title: readarrBook.title,
        });
        return;
      }

      const provider = readarrBook.editions?.some(
        (edition) => edition.isbn13 === identifier
      )
        ? MediaIdentifierProvider.ISBN
        : MediaIdentifierProvider.READARR;
      const hasFile = (readarrBook.statistics?.bookFileCount ?? 0) > 0;
      const totalBooks = readarrBook.statistics?.totalBookCount ?? 1;

      await this.processBook(provider, identifier, {
        serviceId: this.currentServer.id,
        externalServiceId: readarrBook.id,
        externalServiceSlug: readarrBook.titleSlug ?? readarrBook.foreignBookId,
        title: readarrBook.title,
        mediaAddedAt: readarrBook.added
          ? new Date(readarrBook.added)
          : undefined,
        hasFile,
        processing:
          readarrBook.monitored &&
          (readarrBook.statistics
            ? (readarrBook.statistics.bookFileCount ?? 0) < totalBooks
            : !hasFile),
      });
    } catch (e) {
      this.log('Failed to process Readarr media', 'error', {
        errorMessage: e.message,
        title: readarrBook.title,
      });
    }
  }
}

export const readarrScanner = new ReadarrScanner();
