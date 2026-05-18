import type { ReadarrBook } from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { resolveOpenLibraryIdentifiersForReadarrBook } from '@server/lib/bookIdentifierResolver';
import { normalizeIsbn, normalizeValidIsbn } from '@server/lib/isbn';
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

const normalizeReadarrIsbn = (isbn?: string): string | undefined =>
  normalizeValidIsbn(isbn) ?? normalizeIsbn(isbn);

class ReadarrScanner
  extends BaseScanner<ReadarrBook>
  implements RunnableScanner<SyncStatus>
{
  private servers: ReadarrSettings[];
  private currentServer: ReadarrSettings;
  private readarrApi: ReadarrAPI;
  private scannedIdentifierKeys: Set<string> = new Set();
  private didScan = false;

  constructor() {
    super('Bookshelf Scan', { bundleSize: 50 });
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
    this.scannedIdentifierKeys.clear();
    this.didScan = false;

    try {
      this.servers = uniqWith(settings.readarr, (readarrA, readarrB) => {
        return (
          readarrA.hostname === readarrB.hostname &&
          readarrA.port === readarrB.port &&
          readarrA.baseUrl === readarrB.baseUrl &&
          (readarrA.serviceType ?? 'ebook') ===
            (readarrB.serviceType ?? 'ebook')
        );
      });

      for (const server of this.servers) {
        this.currentServer = server;
        if (server.syncEnabled) {
          this.log(
            `Beginning to process Bookshelf server: ${server.name}`,
            'info'
          );

          this.readarrApi = new ReadarrAPI({
            apiKey: server.apiKey,
            url: ReadarrAPI.buildUrl(server, '/api/v1'),
          });

          this.items = await this.readarrApi.getBooks();
          this.didScan = true;
          await this.loop(this.processReadarrBook.bind(this), { sessionId });
        } else {
          this.log(
            `Sync not enabled. Skipping Bookshelf server: ${server.name}`
          );
        }
      }

      if (!this.servers.every((server) => server.syncEnabled)) {
        this.didScan = false;
      }

      await this.cleanupOrphanedBooks();
      this.log('Bookshelf scan complete', 'info');
    } catch (e) {
      this.log('Scan interrupted', 'error', { errorMessage: e.message });
    } finally {
      this.endRun(sessionId);
    }
  }

  private async processReadarrBook(readarrBook: ReadarrBook): Promise<void> {
    try {
      if (!readarrBook.editions?.length) {
        readarrBook.editions = await this.readarrApi.getEditions(
          readarrBook.id
        );
      }

      const identifier =
        readarrBook.editions
          ?.map((edition) => normalizeReadarrIsbn(edition.isbn13))
          .find((isbn): isbn is string => !!isbn) ?? readarrBook.foreignBookId;

      if (!identifier) {
        this.log(
          'No supported identifier found for this book. Skipping item.',
          'debug',
          {
            title: readarrBook.title,
          }
        );
        return;
      }

      const provider = readarrBook.editions?.some(
        (edition) => normalizeReadarrIsbn(edition.isbn13) === identifier
      )
        ? MediaIdentifierProvider.ISBN
        : MediaIdentifierProvider.READARR;
      const resolvedOpenLibraryIdentifiers =
        await resolveOpenLibraryIdentifiersForReadarrBook(readarrBook);

      const secondaryIdentifiers = [
        readarrBook.foreignBookId
          ? {
              provider: MediaIdentifierProvider.READARR,
              value: readarrBook.foreignBookId,
            }
          : undefined,
        ...((readarrBook.editions ?? [])
          .map((edition) => {
            const isbn = normalizeReadarrIsbn(edition.isbn13);

            return isbn
              ? {
                  provider: MediaIdentifierProvider.ISBN,
                  value: isbn,
                }
              : undefined;
          })
          .filter(Boolean) as {
          provider: MediaIdentifierProvider;
          value: string;
        }[]),
        ...resolvedOpenLibraryIdentifiers,
      ].filter(
        (
          item
        ): item is {
          provider: MediaIdentifierProvider;
          value: string;
        } =>
          !!item && !(item.provider === provider && item.value === identifier)
      );

      [{ provider, value: identifier }, ...secondaryIdentifiers].forEach(
        (item) =>
          this.scannedIdentifierKeys.add(`${item.provider}:${item.value}`)
      );

      const hasFile = (readarrBook.statistics?.bookFileCount ?? 0) > 0;
      const totalBooks = readarrBook.statistics?.totalBookCount ?? 1;

      if (!readarrBook.monitored) {
        await this.processBook(provider, identifier, {
          serviceId: this.currentServer.id,
          externalServiceId: readarrBook.id,
          externalServiceSlug:
            readarrBook.titleSlug ?? readarrBook.foreignBookId,
          title: readarrBook.title,
          mediaAddedAt: readarrBook.added
            ? new Date(readarrBook.added)
            : undefined,
          hasFile: false,
          secondaryIdentifiers,
          processing: false,
          bookServiceType: this.currentServer.serviceType ?? 'ebook',
        });
        return;
      }

      await this.processBook(provider, identifier, {
        serviceId: this.currentServer.id,
        externalServiceId: readarrBook.id,
        externalServiceSlug: readarrBook.titleSlug ?? readarrBook.foreignBookId,
        title: readarrBook.title,
        mediaAddedAt: readarrBook.added
          ? new Date(readarrBook.added)
          : undefined,
        hasFile,
        secondaryIdentifiers,
        bookServiceType: this.currentServer.serviceType ?? 'ebook',
        processing:
          readarrBook.monitored &&
          (readarrBook.statistics
            ? (readarrBook.statistics.bookFileCount ?? 0) < totalBooks
            : !hasFile),
      });
    } catch (e) {
      this.log('Failed to process Bookshelf media', 'error', {
        errorMessage: e.message,
        title: readarrBook.title,
      });
    }
  }

  private async cleanupOrphanedBooks(): Promise<void> {
    const mediaRepository = getRepository(Media);

    if (!this.didScan) {
      this.log(
        'Skipping orphaned book cleanup: not all Bookshelf servers were scanned.',
        'info'
      );
      return;
    }

    const processingBooks = await mediaRepository.find({
      where: { mediaType: MediaType.BOOK, status: MediaStatus.PROCESSING },
      relations: { identifiers: true },
    });

    for (const media of processingBooks) {
      const identifierKeys = (media.identifiers ?? []).map(
        (identifier) => `${identifier.provider}:${identifier.value}`
      );

      if (
        identifierKeys.length > 0 &&
        !identifierKeys.some((key) => this.scannedIdentifierKeys.has(key))
      ) {
        media.status = MediaStatus.UNKNOWN;
        await mediaRepository.save(media);
        this.log(
          `Book ${identifierKeys[0]} not found in any Bookshelf server. Status reset to UNKNOWN.`,
          'info'
        );
      }
    }
  }
}

export const readarrScanner = new ReadarrScanner();
