import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import {
  getBrowserImageResponseHeaders,
  shouldSendBrowserImageNotModified,
} from '@server/lib/browserImageCache';
import ImageProxy, {
  getImageResponseContentType,
  sendImage,
  type ImageResponse,
} from '@server/lib/imageproxy';
import { getRemoteAvatarCacheUrl } from '@server/lib/remoteAvatarCache';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { getAppVersion } from '@server/utils/appVersion';
import { getHostname } from '@server/utils/getHostname';
import { getRateLimitKey } from '@server/utils/security';
import { parseOptionalBoundedString } from '@server/utils/validation';
import axios from 'axios';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import gravatarUrl from 'gravatar-url';
import { createHash } from 'node:crypto';

const router = Router();
const MAX_AVATAR_VERSION_LENGTH = 128;
const JELLYFIN_USER_ID_PATTERN = /^[a-f0-9]{32}$/;

const avatarProxyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

let _avatarImageProxy: ImageProxy | null = null;

async function initAvatarImageProxy() {
  if (!_avatarImageProxy) {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOne({
      where: { id: 1 },
      select: ['id', 'jellyfinUserId', 'jellyfinDeviceId'],
      order: { id: 'ASC' },
    });
    const deviceId = admin?.jellyfinDeviceId || 'BOT_seerr';
    const authToken = getSettings().jellyfin.apiKey;
    _avatarImageProxy = new ImageProxy('avatar', '', {
      headers: {
        'X-Emby-Authorization': `MediaBrowser Client="Seerr", Device="Seerr", DeviceId="${deviceId}", Version="${
          getSettings().main.mediaServerType === MediaServerType.EMBY
            ? '1.0.0'
            : getAppVersion()
        }", Token="${authToken}"`,
      },
    });
  }
  return _avatarImageProxy;
}

async function sendCachedAvatarImage({
  imageData,
  immutable = false,
  ifModifiedSince,
  ifNoneMatch,
  res,
  skipNotModified = false,
}: {
  imageData: ImageResponse;
  immutable?: boolean;
  ifModifiedSince: string | string[] | undefined;
  ifNoneMatch: string | string[] | undefined;
  res: Response;
  skipNotModified?: boolean;
}) {
  const etag = `"${imageData.meta.etag}"`;
  const browserCacheHeaders = getBrowserImageResponseHeaders({
    cacheKey: imageData.meta.cacheKey,
    cacheMiss: imageData.meta.cacheMiss,
    etag,
    immutable,
    lastModified: imageData.meta.lastModified,
    maxAge: imageData.meta.curRevalidate,
  });

  if (
    !skipNotModified &&
    shouldSendBrowserImageNotModified({
      etag,
      ifModifiedSince,
      ifNoneMatch,
      lastModified: imageData.meta.lastModified,
    })
  ) {
    return res.status(304).set(browserCacheHeaders).end();
  }

  return sendImage(res, imageData, {
    'Content-Type': getImageResponseContentType(imageData.meta.extension),
    ...browserCacheHeaders,
  });
}

function getJellyfinAvatarUrl(userId: string) {
  const settings = getSettings();
  return settings.main.mediaServerType === MediaServerType.JELLYFIN
    ? `${getHostname()}/UserImage?UserId=${userId}`
    : `${getHostname()}/Users/${userId}/Images/Primary?quality=90`;
}

function computeImageHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function checkAvatarChanged(
  user: User
): Promise<{ changed: boolean; etag?: string }> {
  try {
    if (!user || !user.jellyfinUserId) {
      return { changed: false };
    }

    const jellyfinAvatarUrl = getJellyfinAvatarUrl(user.jellyfinUserId);

    let headResponse;
    try {
      headResponse = await axios.head(jellyfinAvatarUrl);
      if (headResponse.status !== 200) {
        return { changed: false };
      }
    } catch {
      return { changed: false };
    }

    const settings = getSettings();
    let remoteVersion: string;
    if (settings.main.mediaServerType === MediaServerType.JELLYFIN) {
      const remoteLastModifiedStr = headResponse.headers['last-modified'] || '';
      remoteVersion = (
        Date.parse(remoteLastModifiedStr) || Date.now()
      ).toString();
    } else if (settings.main.mediaServerType === MediaServerType.EMBY) {
      remoteVersion =
        headResponse.headers['etag']?.replace(/"/g, '') ||
        Date.now().toString();
    } else {
      remoteVersion = Date.now().toString();
    }

    if (user.avatarVersion && user.avatarVersion === remoteVersion) {
      return { changed: false, etag: user.avatarETag ?? undefined };
    }

    const avatarImageCache = await initAvatarImageProxy();
    await avatarImageCache.clearCachedImage(jellyfinAvatarUrl);
    const imageData = await avatarImageCache.getImage(
      jellyfinAvatarUrl,
      gravatarUrl(user.email || 'none', { default: 'mm', size: 200 })
    );

    if (!imageData.imageBuffer) {
      return { changed: false, etag: user.avatarETag ?? undefined };
    }

    const newHash = computeImageHash(imageData.imageBuffer);

    const hasChanged = user.avatarETag !== newHash;

    user.avatarVersion = remoteVersion;
    if (hasChanged) {
      user.avatarETag = newHash;
    }

    await getRepository(User).save(user);

    return { changed: hasChanged, etag: newHash };
  } catch (error) {
    logger.error('Error checking avatar changes', {
      errorMessage: error.message,
    });
    return { changed: false };
  }
}

router.get('/remote', avatarProxyRateLimit, async (req, res) => {
  try {
    if (Array.isArray(req.query.url)) {
      return res.status(400).json({ error: 'Avatar URL must be a string' });
    }

    const avatarUrl = getRemoteAvatarCacheUrl(req.query.url);

    if (!avatarUrl) {
      return res.status(400).json({ error: 'Unsupported avatar URL' });
    }

    const avatarImageCache = await initAvatarImageProxy();
    const imageData = await avatarImageCache.getImage(avatarUrl);

    return sendCachedAvatarImage({
      imageData,
      ifModifiedSince: req.headers['if-modified-since'],
      ifNoneMatch: req.headers['if-none-match'],
      res,
    });
  } catch (e) {
    logger.error('Failed to proxy remote avatar image', {
      errorMessage: e.message,
    });

    if (!res.headersSent) {
      return res.status(400).json({ error: e.message });
    }
  }
});

router.get('/:jellyfinUserId', avatarProxyRateLimit, async (req, res) => {
  try {
    const jellyfinUserId = req.params.jellyfinUserId;

    if (
      typeof jellyfinUserId !== 'string' ||
      !JELLYFIN_USER_ID_PATTERN.test(jellyfinUserId)
    ) {
      const mediaServerType = getSettings().main.mediaServerType;
      return res.status(400).json({
        error: `Provided URL is not ${
          mediaServerType === MediaServerType.JELLYFIN
            ? 'a Jellyfin'
            : 'an Emby'
        } avatar.`,
      });
    }

    const avatarImageCache = await initAvatarImageProxy();

    const userEtag = req.headers['if-none-match'];

    const versionParam = parseOptionalBoundedString(req.query.v, {
      fieldName: 'Avatar version',
      maxLength: MAX_AVATAR_VERSION_LENGTH,
    });
    if ('error' in versionParam) {
      return res.status(400).json({ error: versionParam.error });
    }

    const user = await getRepository(User).findOne({
      where: { jellyfinUserId },
    });

    const fallbackUrl = gravatarUrl(user?.email || 'none', {
      default: 'mm',
      size: 200,
    });

    const jellyfinAvatarUrl = getJellyfinAvatarUrl(jellyfinUserId);

    let imageData;
    if (user?.avatarVersion) {
      imageData = await avatarImageCache.getImage(
        jellyfinAvatarUrl,
        fallbackUrl
      );
      if (imageData.meta.extension === 'json') {
        imageData = await avatarImageCache.getImage(fallbackUrl);
      }
    } else {
      imageData = await avatarImageCache.getImage(fallbackUrl);
    }

    await sendCachedAvatarImage({
      imageData,
      ifModifiedSince: req.headers['if-modified-since'],
      ifNoneMatch: userEtag,
      immutable: Boolean(versionParam.value),
      res,
      skipNotModified: Boolean(versionParam.value),
    });
  } catch (e) {
    logger.error('Failed to proxy avatar image', {
      errorMessage: e.message,
    });

    if (!res.headersSent) {
      return res.status(400).json({ error: e.message });
    }
  }
});

export default router;
