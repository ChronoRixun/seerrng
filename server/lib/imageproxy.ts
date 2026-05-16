import logger from '@server/logger';
import { requestInterceptorFunction } from '@server/utils/customProxyAgent';
import axios, { type AxiosInstance } from 'axios';
import rateLimit, { type rateLimitOptions } from 'axios-rate-limit';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { createReadStream, promises } from 'fs';
import mime from 'mime/lite';
import path, { join } from 'path';
import sharp from 'sharp';

type ImageMeta = {
  revalidateAfter: number;
  curRevalidate: number;
  isStale: boolean;
  etag: string;
  extension: string | null;
  cacheKey: string;
  cacheMiss: boolean;
};

type ImageResponse = {
  meta: ImageMeta;
  // Exactly one of these is set: a buffer for hot/just-fetched images,
  // or a file path to stream from disk for larger cold images.
  imageBuffer?: Buffer;
  filePath?: string;
};

const baseCacheDirectory = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/cache/images`
  : path.join(__dirname, '../../config/cache/images');

const WEBP_QUALITY = 80;
const LRU_MAX_BYTES = 64 * 1024 * 1024;
const LRU_MAX_ENTRIES = 512;
// Images larger than this are streamed from disk instead of held in memory.
const LRU_ITEM_MAX_BYTES = 1.5 * 1024 * 1024;
const TRANSCODABLE_CONTENT_TYPE = /^image\/(jpe?g|png|webp|avif|bmp|tiff)$/i;

type LruEntry = {
  buffer: Buffer;
  maxAge: number;
  expireAt: number;
  etag: string;
  extension: string | null;
};

/**
 * Process-wide LRU of decoded image bytes, shared across all ImageProxy
 * instances. Cache keys are SHA-256 hashes that already incorporate the
 * proxy key + version + path, so they are globally unique.
 */
class ImageMemoryCache {
  private map = new Map<string, LruEntry>();
  private bytes = 0;

  public get(key: string): LruEntry | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }
    // Mark as most-recently-used.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  public set(key: string, entry: LruEntry): void {
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.buffer.length;
      this.map.delete(key);
    }
    this.map.set(key, entry);
    this.bytes += entry.buffer.length;
    this.evict();
  }

  public delete(key: string): void {
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.buffer.length;
      this.map.delete(key);
    }
  }

  public clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  private evict(): void {
    while (
      (this.bytes > LRU_MAX_BYTES || this.map.size > LRU_MAX_ENTRIES) &&
      this.map.size > 0
    ) {
      const oldestKey = this.map.keys().next().value as string;
      const oldest = this.map.get(oldestKey);
      if (oldest) {
        this.bytes -= oldest.buffer.length;
      }
      this.map.delete(oldestKey);
    }
  }
}

const memoryCache = new ImageMemoryCache();

/**
 * Writes the response headers and body for a cached image, streaming from
 * disk when the payload was not small enough to keep in memory.
 */
export async function sendImage(
  res: Response,
  imageData: ImageResponse,
  headers: Record<string, string | number>
): Promise<void> {
  if (imageData.imageBuffer) {
    res.writeHead(200, {
      ...headers,
      'Content-Length': imageData.imageBuffer.length,
    });
    res.end(imageData.imageBuffer);
    return;
  }

  if (!imageData.filePath) {
    res.status(500).end();
    return;
  }

  try {
    const { size } = await promises.stat(imageData.filePath);
    res.writeHead(200, { ...headers, 'Content-Length': size });
    const stream = createReadStream(imageData.filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.destroy();
    });
    stream.pipe(res);
  } catch {
    res.status(500).end();
  }
}

class ImageProxy {
  public static async clearCache(key: string) {
    let deletedImages = 0;
    const cacheDirectory = path.join(baseCacheDirectory, key);

    try {
      const files = await promises.readdir(cacheDirectory);

      for (const file of files) {
        const filePath = path.join(cacheDirectory, file);
        const stat = await promises.lstat(filePath);

        if (stat.isDirectory()) {
          const imageFiles = await promises.readdir(filePath);

          for (const imageFile of imageFiles) {
            const [, expireAtSt] = imageFile.split('.');
            const expireAt = Number(expireAtSt);
            const now = Date.now();

            if (now > expireAt) {
              await promises.rm(path.join(filePath), {
                recursive: true,
              });
              deletedImages += 1;
            }
          }
        }
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        return;
      }
      logger.error('Failed to read directory', {
        label: 'Image Cache',
        message: e.message,
      });
    }

    // On-disk entries were pruned; drop the in-memory mirror so stale
    // bytes are not served from RAM.
    memoryCache.clear();

    logger.info(`Cleared ${deletedImages} stale image(s) from cache '${key}'`, {
      label: 'Image Cache',
    });
  }

  public static async getImageStats(
    key: string
  ): Promise<{ size: number; imageCount: number }> {
    const cacheDirectory = path.join(baseCacheDirectory, key);

    const imageTotalSize = await ImageProxy.getDirectorySize(cacheDirectory);
    const imageCount = await ImageProxy.getImageCount(cacheDirectory);

    return {
      size: imageTotalSize,
      imageCount,
    };
  }

  private static async getDirectorySize(dir: string): Promise<number> {
    try {
      const files = await promises.readdir(dir, {
        withFileTypes: true,
      });

      const paths = files.map(async (file) => {
        const path = join(dir, file.name);

        if (file.isDirectory()) return await ImageProxy.getDirectorySize(path);

        if (file.isFile()) {
          const { size } = await promises.stat(path);

          return size;
        }

        return 0;
      });

      return (await Promise.all(paths))
        .flat(Infinity)
        .reduce((i, size) => i + size, 0);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return 0;
      }
    }

    return 0;
  }

  private static async getImageCount(dir: string) {
    try {
      const files = await promises.readdir(dir);

      return files.length;
    } catch (e) {
      if (e.code === 'ENOENT') {
        return 0;
      }
    }

    return 0;
  }

  private axios: AxiosInstance;
  private cacheVersion;
  private key;

  constructor(
    key: string,
    baseUrl: string,
    options: {
      cacheVersion?: number;
      rateLimitOptions?: rateLimitOptions;
      headers?: Record<string, string>;
    } = {}
  ) {
    // Bumped to 2 when WebP transcoding was introduced so previously
    // cached originals are re-fetched and re-encoded.
    this.cacheVersion = options.cacheVersion ?? 2;
    this.key = key;
    this.axios = axios.create({
      baseURL: baseUrl,
      headers: options.headers,
    });
    this.axios.interceptors.request.use(requestInterceptorFunction);

    if (options.rateLimitOptions) {
      this.axios = rateLimit(this.axios, options.rateLimitOptions);
    }
  }

  public async getImage(
    path: string,
    fallbackPath?: string
  ): Promise<ImageResponse> {
    const cacheKey = this.getCacheKey(path);

    const imageResponse = await this.get(cacheKey);

    if (!imageResponse) {
      const newImage = await this.set(path, cacheKey);

      if (!newImage) {
        if (fallbackPath) {
          return await this.getImage(fallbackPath);
        } else {
          throw new Error('Failed to load image');
        }
      }

      return newImage;
    }

    // If the image is stale, we will revalidate it in the background.
    if (imageResponse.meta.isStale) {
      this.set(path, cacheKey);
    }

    return imageResponse;
  }

  public async clearCachedImage(path: string) {
    // find cacheKey
    const cacheKey = this.getCacheKey(path);
    const directory = join(this.getCacheDirectory(), cacheKey);

    memoryCache.delete(cacheKey);

    try {
      await promises.access(directory);
    } catch (e) {
      if (e.code === 'ENOENT') {
        logger.debug(
          `Cache directory '${cacheKey}' does not exist; nothing to clear.`,
          {
            label: 'Image Cache',
          }
        );
        return;
      } else {
        logger.error('Error checking cache directory existence', {
          label: 'Image Cache',
          message: e.message,
        });
        return;
      }
    }

    try {
      const files = await promises.readdir(directory);

      await promises.rm(directory, { recursive: true });

      logger.debug(`Cleared ${files[0]} from cache 'avatar'`, {
        label: 'Image Cache',
      });
    } catch (e) {
      logger.error('Failed to clear cached image', {
        label: 'Image Cache',
        message: e.message,
      });
    }
  }

  private async get(cacheKey: string): Promise<ImageResponse | null> {
    const now = Date.now();

    const cached = memoryCache.get(cacheKey);
    if (cached) {
      return {
        meta: {
          curRevalidate: cached.maxAge,
          revalidateAfter: cached.expireAt,
          isStale: now > cached.expireAt,
          etag: cached.etag,
          extension: cached.extension,
          cacheKey,
          cacheMiss: false,
        },
        imageBuffer: cached.buffer,
      };
    }

    try {
      const directory = join(this.getCacheDirectory(), cacheKey);
      const files = await promises.readdir(directory);

      for (const file of files) {
        const [maxAgeSt, expireAtSt, etag, extension] = file.split('.');
        const filePath = join(directory, file);
        const expireAt = Number(expireAtSt);
        const maxAge = Number(maxAgeSt);

        const meta: ImageMeta = {
          curRevalidate: maxAge,
          revalidateAfter: maxAge * 1000 + now,
          isStale: now > expireAt,
          etag,
          extension,
          cacheKey,
          cacheMiss: false,
        };

        const { size } = await promises.stat(filePath);

        if (size <= LRU_ITEM_MAX_BYTES) {
          const buffer = await promises.readFile(filePath);
          memoryCache.set(cacheKey, {
            buffer,
            maxAge,
            expireAt,
            etag,
            extension,
          });
          return { meta, imageBuffer: buffer };
        }

        return { meta, filePath };
      }
    } catch {
      // No files. Treat as empty cache.
    }

    return null;
  }

  private async set(
    path: string,
    cacheKey: string
  ): Promise<ImageResponse | null> {
    try {
      const directory = join(this.getCacheDirectory(), cacheKey);
      const response = await this.axios.get(path, {
        responseType: 'arraybuffer',
      });

      let buffer = Buffer.from(response.data, 'binary');

      const contentType = response.headers['content-type'] || '';
      let extension = mime.getExtension(contentType) || '';

      if (TRANSCODABLE_CONTENT_TYPE.test(contentType)) {
        try {
          buffer = await sharp(buffer, { animated: true })
            .webp({ quality: WEBP_QUALITY })
            .toBuffer();
          extension = 'webp';
        } catch (e) {
          logger.debug('Failed to transcode image to WebP; storing original', {
            label: 'Image Cache',
            errorMessage: e.message,
          });
        }
      }

      let maxAge = Number(
        (response.headers['cache-control'] ?? '0').split('=')[1]
      );

      if (!maxAge) maxAge = 86400;
      const expireAt = Date.now() + maxAge * 1000;
      const etag = (response.headers.etag ?? '').replace(/"/g, '');

      const filePath = await this.writeToCacheDir(
        directory,
        extension,
        maxAge,
        expireAt,
        buffer,
        etag
      );

      if (buffer.length <= LRU_ITEM_MAX_BYTES) {
        memoryCache.set(cacheKey, {
          buffer,
          maxAge,
          expireAt,
          etag,
          extension,
        });
      } else {
        memoryCache.delete(cacheKey);
      }

      return {
        meta: {
          curRevalidate: maxAge,
          revalidateAfter: expireAt,
          isStale: false,
          etag,
          extension,
          cacheKey,
          cacheMiss: true,
        },
        ...(buffer.length <= LRU_ITEM_MAX_BYTES
          ? { imageBuffer: buffer }
          : { filePath }),
      };
    } catch (e) {
      logger.debug('Something went wrong caching image.', {
        label: 'Image Cache',
        errorMessage: e.message,
      });
      return null;
    }
  }

  private async writeToCacheDir(
    dir: string,
    extension: string | null,
    maxAge: number,
    expireAt: number,
    buffer: Buffer,
    etag: string
  ): Promise<string> {
    const filename = join(dir, `${maxAge}.${expireAt}.${etag}.${extension}`);

    await promises.rm(dir, { force: true, recursive: true }).catch(() => {
      // do nothing
    });

    await promises.mkdir(dir, { recursive: true });
    await promises.writeFile(filename, buffer);

    return filename;
  }

  private getCacheKey(path: string) {
    return this.getHash([this.key, this.cacheVersion, path]);
  }

  private getHash(items: (string | number | Buffer)[]) {
    const hash = createHash('sha256');
    for (const item of items) {
      if (typeof item === 'number') hash.update(String(item));
      else {
        hash.update(item);
      }
    }
    // See https://en.wikipedia.org/wiki/Base64#Filenames
    return hash.digest('base64').replace(/\//g, '-');
  }

  private getCacheDirectory() {
    return path.join(baseCacheDirectory, this.key);
  }
}

export default ImageProxy;
