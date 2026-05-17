import type Issue from '@server/entity/Issue';
import type IssueComment from '@server/entity/IssueComment';
import type Media from '@server/entity/Media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import type { NotificationAgentConfig } from '@server/lib/settings';
import type { Notification } from '..';

export interface NotificationPayload {
  event?: string;
  subject: string;
  notifySystem: boolean;
  notifyAdmin: boolean;
  notifyUser?: User;
  media?: Media;
  mediaUrl?: string;
  image?: string;
  message?: string;
  extra?: { name: string; value: string }[];
  request?: MediaRequest;
  issue?: Issue;
  comment?: IssueComment;
  pendingRequestsCount?: number;
  isAdmin?: boolean;
}

const isSafeRelativeNotificationPath = (value: string): boolean =>
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !/[\r\n]/.test(value) &&
  !/^[a-z][a-z0-9+.-]*:/i.test(value);

export const getNotificationMediaUrl = (
  payload: Pick<NotificationPayload, 'media' | 'mediaUrl'>
): string | undefined => {
  if (payload.mediaUrl) {
    return isSafeRelativeNotificationPath(payload.mediaUrl)
      ? payload.mediaUrl
      : undefined;
  }

  if (!payload.media) {
    return undefined;
  }

  if (payload.media.mediaType === 'music') {
    return payload.media.mbId ? `/music/${payload.media.mbId}` : undefined;
  }

  if (payload.media.mediaType === 'book') {
    const openLibraryId = payload.media.identifiers?.find(
      (identifier) => identifier.provider === 'openlibrary'
    )?.value;

    return openLibraryId ? `/book/${openLibraryId}` : undefined;
  }

  return `/${payload.media.mediaType}/${payload.media.tmdbId}`;
};

export const getNotificationActionUrl = (
  payload: Pick<NotificationPayload, 'issue' | 'media' | 'mediaUrl'>,
  applicationUrl?: string
): string | undefined => {
  if (!applicationUrl) {
    return undefined;
  }

  if (payload.issue) {
    return `${applicationUrl}/issues/${payload.issue.id}`;
  }

  const mediaUrl = getNotificationMediaUrl(payload);

  return mediaUrl ? `${applicationUrl}${mediaUrl}` : undefined;
};

export abstract class BaseAgent<T extends NotificationAgentConfig> {
  protected settings?: T;
  public constructor(settings?: T) {
    this.settings = settings;
  }

  protected abstract getSettings(): T;
}

export interface NotificationAgent {
  shouldSend(): boolean;
  send(type: Notification, payload: NotificationPayload): Promise<boolean>;
}
