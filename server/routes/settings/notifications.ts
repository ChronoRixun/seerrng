import type { User } from '@server/entity/User';
import { defineMessages, getIntl } from '@server/i18n';
import { Notification } from '@server/lib/notifications';
import type { NotificationAgent } from '@server/lib/notifications/agents/agent';
import DiscordAgent from '@server/lib/notifications/agents/discord';
import EmailAgent from '@server/lib/notifications/agents/email';
import GotifyAgent from '@server/lib/notifications/agents/gotify';
import NtfyAgent from '@server/lib/notifications/agents/ntfy';
import PushbulletAgent from '@server/lib/notifications/agents/pushbullet';
import PushoverAgent from '@server/lib/notifications/agents/pushover';
import SlackAgent from '@server/lib/notifications/agents/slack';
import TelegramAgent from '@server/lib/notifications/agents/telegram';
import WebhookAgent from '@server/lib/notifications/agents/webhook';
import WebPushAgent from '@server/lib/notifications/agents/webpush';
import {
  getSettings,
  type NotificationAgentConfig,
  type NotificationAgentDiscord,
  type NotificationAgentEmail,
  type NotificationAgentGotify,
  type NotificationAgentNtfy,
  type NotificationAgentPushbullet,
  type NotificationAgentPushover,
  type NotificationAgentSlack,
  type NotificationAgentTelegram,
  type NotificationAgentWebhook,
} from '@server/lib/settings';
import type { AvailableLocale } from '@server/types/languages';
import {
  isSafeHttpUrl,
  preserveRedactedSecrets,
  redactSecrets,
} from '@server/utils/security';
import {
  parseOptionalBodyBoolean,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router } from 'express';

const notificationRoutes = Router();
const MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1024;
const MAX_WEBHOOK_CUSTOM_HEADERS = 20;
const MAX_WEBHOOK_HEADER_VALUE_LENGTH = 4096;
const MAX_NOTIFICATION_OPTION_STRING_LENGTH = 4096;
const MAX_NOTIFICATION_TYPES = 0x7fffffff;
const MAX_NOTIFICATION_PRIORITY = 1000;
const MAX_PORT = 65_535;
const WEBHOOK_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const messages = defineMessages('notifications.test', {
  subject: 'Test Notification',
  message: 'Check check, 1, 2, 3. Are we coming in clear?',
});

type RouteError = { status: number; message: string };
type UrlNotificationBody = {
  enabled: boolean;
  embedPoster: boolean;
  types: number;
  options: Record<string, unknown> & { url: string };
};

type WebhookUrlNotificationBody = {
  enabled: boolean;
  embedPoster: boolean;
  types: number;
  options: Record<string, unknown> & { webhookUrl: string };
};

type GenericNotificationBody = {
  enabled: boolean;
  embedPoster: boolean;
  types: number;
  options: Record<string, unknown>;
};

const sendTestNotification = async (agent: NotificationAgent, user: User) => {
  const intl = getIntl(user.settings?.locale as AvailableLocale);

  return await agent.send(Notification.TEST_NOTIFICATION, {
    notifySystem: true,
    notifyAdmin: false,
    notifyUser: user,
    subject: intl.formatMessage(messages.subject),
    message: intl.formatMessage(messages.message),
  });
};

const validateWebhookPayload = (value: unknown) => {
  if (typeof value !== 'string') {
    return { status: 400, message: 'Webhook payload must be a JSON string.' };
  }

  if (Buffer.byteLength(value, 'utf8') > MAX_WEBHOOK_PAYLOAD_BYTES) {
    return { status: 400, message: 'Webhook payload is too large.' };
  }

  try {
    JSON.parse(value);
  } catch {
    return { status: 400, message: 'Webhook payload must be valid JSON.' };
  }
};

const validateWebhookHeaders = (
  headers: unknown
): { status: number; message: string } | undefined => {
  if (headers === undefined) {
    return;
  }

  if (!Array.isArray(headers)) {
    return { status: 400, message: 'Webhook custom headers must be an array.' };
  }

  if (headers.length > MAX_WEBHOOK_CUSTOM_HEADERS) {
    return { status: 400, message: 'Too many webhook custom headers.' };
  }

  for (const header of headers) {
    if (!header || typeof header !== 'object') {
      return { status: 400, message: 'Invalid webhook custom header.' };
    }

    const { key, value } = header as { key?: unknown; value?: unknown };
    if (typeof key !== 'string' || typeof value !== 'string') {
      return { status: 400, message: 'Invalid webhook custom header.' };
    }

    if (
      !WEBHOOK_HEADER_NAME.test(key.trim()) ||
      /[\r\n]/.test(value) ||
      value.length > MAX_WEBHOOK_HEADER_VALUE_LENGTH
    ) {
      return { status: 400, message: 'Invalid webhook custom header.' };
    }
  }
};

const parseWebhookBody = (body: unknown) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error: { status: 400, message: 'Webhook settings must be an object.' },
    };
  }

  const value = body as {
    enabled?: unknown;
    embedPoster?: unknown;
    types?: unknown;
    options?: unknown;
  };
  const enabled = parseOptionalBodyBoolean(value.enabled, 'Enabled');
  if ('error' in enabled) {
    return { error: { status: 400, message: enabled.error } };
  }
  const embedPoster = parseOptionalBodyBoolean(
    value.embedPoster,
    'Embed poster'
  );
  if ('error' in embedPoster) {
    return { error: { status: 400, message: embedPoster.error } };
  }
  const types = parseOptionalNonNegativeInteger(
    value.types,
    MAX_NOTIFICATION_TYPES
  );
  if (types === undefined) {
    return {
      error: { status: 400, message: 'Notification types must be valid.' },
    };
  }
  if (
    !value.options ||
    typeof value.options !== 'object' ||
    Array.isArray(value.options)
  ) {
    return {
      error: { status: 400, message: 'Webhook options must be an object.' },
    };
  }

  const options = value.options as {
    jsonPayload?: unknown;
    webhookUrl?: unknown;
    authHeader?: unknown;
    customHeaders?: unknown;
    supportVariables?: unknown;
  };
  const supportVariables = parseOptionalBodyBoolean(
    options.supportVariables,
    'Support variables'
  );
  if ('error' in supportVariables) {
    return { error: { status: 400, message: supportVariables.error } };
  }
  if (typeof options.webhookUrl !== 'string') {
    return { error: { status: 400, message: 'Webhook URL must be a string.' } };
  }
  if (
    options.authHeader !== undefined &&
    typeof options.authHeader !== 'string'
  ) {
    return { error: { status: 400, message: 'Auth header must be a string.' } };
  }
  let customHeaders: { key: string; value: string }[] | undefined;
  if (options.customHeaders !== undefined) {
    if (!Array.isArray(options.customHeaders)) {
      return {
        error: {
          status: 400,
          message: 'Webhook custom headers must be an array.',
        },
      };
    }

    customHeaders = [];
    for (const header of options.customHeaders) {
      if (!header || typeof header !== 'object') {
        return {
          error: { status: 400, message: 'Invalid webhook custom header.' },
        };
      }
      const { key, value } = header as { key?: unknown; value?: unknown };
      if (typeof key !== 'string' || typeof value !== 'string') {
        return {
          error: { status: 400, message: 'Invalid webhook custom header.' },
        };
      }
      customHeaders.push({ key, value });
    }
  }

  const parsedWebhook: NotificationAgentWebhook = {
    enabled: enabled.value ?? false,
    embedPoster: embedPoster.value ?? false,
    types,
    options: {
      jsonPayload: options.jsonPayload as string,
      webhookUrl: options.webhookUrl,
      authHeader: options.authHeader,
      customHeaders,
      supportVariables: supportVariables.value ?? false,
    },
  };

  return {
    value: parsedWebhook,
  };
};

const parseUrlNotificationBody = (
  body: unknown,
  label: string
): { value: UrlNotificationBody } | { error: RouteError } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error: { status: 400, message: `${label} settings must be an object.` },
    };
  }

  const value = body as {
    enabled?: unknown;
    embedPoster?: unknown;
    types?: unknown;
    options?: unknown;
  };
  const enabled = parseOptionalBodyBoolean(value.enabled, 'Enabled');
  if ('error' in enabled) {
    return { error: { status: 400, message: enabled.error } };
  }
  const embedPoster = parseOptionalBodyBoolean(
    value.embedPoster,
    'Embed poster'
  );
  if ('error' in embedPoster) {
    return { error: { status: 400, message: embedPoster.error } };
  }
  const types = parseOptionalNonNegativeInteger(
    value.types,
    MAX_NOTIFICATION_TYPES
  );
  if (types === undefined) {
    return {
      error: { status: 400, message: 'Notification types must be valid.' },
    };
  }
  if (
    !value.options ||
    typeof value.options !== 'object' ||
    Array.isArray(value.options)
  ) {
    return {
      error: { status: 400, message: `${label} options must be an object.` },
    };
  }

  const options = value.options as Record<string, unknown>;
  if (typeof options.url !== 'string') {
    return {
      error: { status: 400, message: `${label} URL must be a string.` },
    };
  }
  if (options.url.length > MAX_NOTIFICATION_OPTION_STRING_LENGTH) {
    return {
      error: {
        status: 400,
        message: `${label} URL must be ${MAX_NOTIFICATION_OPTION_STRING_LENGTH} characters or fewer.`,
      },
    };
  }

  const validateOptionalString = (option: string) => {
    const optionValue = options[option];
    if (optionValue === undefined || optionValue === null) {
      return;
    }
    if (typeof optionValue !== 'string') {
      return {
        status: 400,
        message: `${label} ${option} must be a string.`,
      };
    }
    if (optionValue.length > MAX_NOTIFICATION_OPTION_STRING_LENGTH) {
      return {
        status: 400,
        message: `${label} ${option} must be ${MAX_NOTIFICATION_OPTION_STRING_LENGTH} characters or fewer.`,
      };
    }
  };

  const validateOptionalBoolean = (option: string) => {
    const optionValue = options[option];
    if (optionValue === undefined || optionValue === null) {
      return;
    }
    if (typeof optionValue !== 'boolean') {
      return {
        status: 400,
        message: `${label} ${option} must be a boolean.`,
      };
    }
  };

  const validateOptionalPriority = () => {
    const optionValue = options.priority;
    if (optionValue === undefined || optionValue === null) {
      return;
    }
    if (
      typeof optionValue !== 'number' ||
      !Number.isInteger(optionValue) ||
      optionValue < 0 ||
      optionValue > MAX_NOTIFICATION_PRIORITY
    ) {
      return {
        status: 400,
        message: `${label} priority must be an integer between 0 and ${MAX_NOTIFICATION_PRIORITY}.`,
      };
    }
  };

  const optionErrors = [
    validateOptionalString('token'),
    validateOptionalString('topic'),
    validateOptionalString('locale'),
    validateOptionalString('username'),
    validateOptionalString('password'),
    validateOptionalBoolean('authMethodUsernamePassword'),
    validateOptionalBoolean('authMethodToken'),
    validateOptionalPriority(),
  ].filter(Boolean);
  if (optionErrors.length > 0) {
    return { error: optionErrors[0] as RouteError };
  }

  return {
    value: {
      enabled: enabled.value ?? false,
      embedPoster: embedPoster.value ?? false,
      types,
      options: {
        ...options,
        url: options.url,
      },
    },
  };
};

const parseGenericNotificationBody = (
  body: unknown,
  label: string,
  requiredStringOptions: string[] = [],
  requiredBooleanOptions: string[] = [],
  requiredNumberOptions: string[] = []
): { value: GenericNotificationBody } | { error: RouteError } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error: { status: 400, message: `${label} settings must be an object.` },
    };
  }

  const value = body as {
    enabled?: unknown;
    embedPoster?: unknown;
    types?: unknown;
    options?: unknown;
  };
  const enabled = parseOptionalBodyBoolean(value.enabled, 'Enabled');
  if ('error' in enabled) {
    return { error: { status: 400, message: enabled.error } };
  }
  const embedPoster = parseOptionalBodyBoolean(
    value.embedPoster,
    'Embed poster'
  );
  if ('error' in embedPoster) {
    return { error: { status: 400, message: embedPoster.error } };
  }
  const types = parseOptionalNonNegativeInteger(
    value.types,
    MAX_NOTIFICATION_TYPES
  );
  if (types === undefined) {
    return {
      error: { status: 400, message: 'Notification types must be valid.' },
    };
  }
  if (
    !value.options ||
    typeof value.options !== 'object' ||
    Array.isArray(value.options)
  ) {
    return {
      error: { status: 400, message: `${label} options must be an object.` },
    };
  }

  const options = value.options as Record<string, unknown>;
  for (const option of requiredStringOptions) {
    const optionValue = options[option];
    if (typeof optionValue !== 'string') {
      return {
        error: {
          status: 400,
          message: `${label} ${option} must be a string.`,
        },
      };
    }

    if (optionValue.length > MAX_NOTIFICATION_OPTION_STRING_LENGTH) {
      return {
        error: {
          status: 400,
          message: `${label} ${option} must be ${MAX_NOTIFICATION_OPTION_STRING_LENGTH} characters or fewer.`,
        },
      };
    }
  }
  for (const option of requiredBooleanOptions) {
    const optionValue = options[option];
    if (typeof optionValue !== 'boolean') {
      return {
        error: {
          status: 400,
          message: `${label} ${option} must be a boolean.`,
        },
      };
    }
  }
  for (const option of requiredNumberOptions) {
    const optionValue = options[option];
    if (
      typeof optionValue !== 'number' ||
      !Number.isInteger(optionValue) ||
      optionValue < 1 ||
      optionValue > MAX_PORT
    ) {
      return {
        error: {
          status: 400,
          message: `${label} ${option} must be an integer between 1 and 65535.`,
        },
      };
    }
  }

  return {
    value: {
      enabled: enabled.value ?? false,
      embedPoster: embedPoster.value ?? false,
      types,
      options,
    },
  };
};

const parseWebhookUrlNotificationBody = (
  body: unknown,
  label: string
): { value: WebhookUrlNotificationBody } | { error: RouteError } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error: { status: 400, message: `${label} settings must be an object.` },
    };
  }

  const value = body as {
    enabled?: unknown;
    embedPoster?: unknown;
    types?: unknown;
    options?: unknown;
  };
  const enabled = parseOptionalBodyBoolean(value.enabled, 'Enabled');
  if ('error' in enabled) {
    return { error: { status: 400, message: enabled.error } };
  }
  const embedPoster = parseOptionalBodyBoolean(
    value.embedPoster,
    'Embed poster'
  );
  if ('error' in embedPoster) {
    return { error: { status: 400, message: embedPoster.error } };
  }
  const types = parseOptionalNonNegativeInteger(
    value.types,
    MAX_NOTIFICATION_TYPES
  );
  if (types === undefined) {
    return {
      error: { status: 400, message: 'Notification types must be valid.' },
    };
  }
  if (
    !value.options ||
    typeof value.options !== 'object' ||
    Array.isArray(value.options)
  ) {
    return {
      error: { status: 400, message: `${label} options must be an object.` },
    };
  }

  const options = value.options as Record<string, unknown>;
  if (typeof options.webhookUrl !== 'string') {
    return {
      error: { status: 400, message: `${label} webhook URL must be a string.` },
    };
  }

  return {
    value: {
      enabled: enabled.value ?? false,
      embedPoster: embedPoster.value ?? false,
      types,
      options: {
        ...options,
        webhookUrl: options.webhookUrl,
      },
    },
  };
};

const validateNotificationUrl = async (
  value: unknown,
  label: string,
  options: { allowTemplates?: boolean } = {}
) => {
  const allowPrivateAddresses =
    process.env.SEERR_ALLOW_PRIVATE_NOTIFICATION_URLS === 'true';

  if (
    !(await isSafeHttpUrl(value, {
      ...options,
      allowPrivateAddresses,
    }))
  ) {
    return {
      status: 400,
      message: allowPrivateAddresses
        ? `${label} must be a valid HTTP or HTTPS URL.`
        : `${label} must be a valid public HTTP or HTTPS URL.`,
    };
  }
};

notificationRoutes.get('/discord', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.notifications.agents.discord));
});

notificationRoutes.post('/discord', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseWebhookUrlNotificationBody(req.body, 'Discord');
  if ('error' in parsedBody) {
    return res.status(parsedBody.error.status).json(parsedBody.error);
  }
  const body = parsedBody.value;
  const validationError = body.enabled
    ? await validateNotificationUrl(
        body.options.webhookUrl,
        'Discord webhook URL'
      )
    : undefined;

  if (validationError) {
    return res.status(validationError.status).json(validationError);
  }

  settings.notifications.agents.discord = preserveRedactedSecrets(
    body as NotificationAgentDiscord,
    settings.notifications.agents.discord
  );
  await settings.save();

  res.status(200).json(redactSecrets(settings.notifications.agents.discord));
});

notificationRoutes.post('/discord/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  const parsedBody = parseWebhookUrlNotificationBody(req.body, 'Discord');
  if ('error' in parsedBody) {
    return next(parsedBody.error);
  }
  const body = parsedBody.value;

  const validationError = await validateNotificationUrl(
    body.options.webhookUrl,
    'Discord webhook URL'
  );

  if (validationError) {
    return next(validationError);
  }

  const discordAgent = new DiscordAgent(body as NotificationAgentDiscord);
  if (await sendTestNotification(discordAgent, req.user)) {
    return res.status(204).send();
  } else {
    return next({
      status: 500,
      message: 'Failed to send Discord notification.',
    });
  }
});

notificationRoutes.get('/slack', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.notifications.agents.slack));
});

notificationRoutes.post('/slack', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseWebhookUrlNotificationBody(req.body, 'Slack');
  if ('error' in parsedBody) {
    return res.status(parsedBody.error.status).json(parsedBody.error);
  }
  const body = parsedBody.value;
  const validationError = body.enabled
    ? await validateNotificationUrl(
        body.options.webhookUrl,
        'Slack webhook URL'
      )
    : undefined;

  if (validationError) {
    return res.status(validationError.status).json(validationError);
  }

  settings.notifications.agents.slack = preserveRedactedSecrets(
    body as NotificationAgentSlack,
    settings.notifications.agents.slack
  );
  await settings.save();

  res.status(200).json(redactSecrets(settings.notifications.agents.slack));
});

notificationRoutes.post('/slack/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  const parsedBody = parseWebhookUrlNotificationBody(req.body, 'Slack');
  if ('error' in parsedBody) {
    return next(parsedBody.error);
  }
  const body = parsedBody.value;

  const validationError = await validateNotificationUrl(
    body.options.webhookUrl,
    'Slack webhook URL'
  );

  if (validationError) {
    return next(validationError);
  }

  const slackAgent = new SlackAgent(body as NotificationAgentSlack);
  if (await sendTestNotification(slackAgent, req.user)) {
    return res.status(204).send();
  } else {
    return next({
      status: 500,
      message: 'Failed to send Slack notification.',
    });
  }
});

notificationRoutes.get('/telegram', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.notifications.agents.telegram));
});

notificationRoutes.post('/telegram', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseGenericNotificationBody(
    req.body,
    'Telegram',
    ['botAPI', 'chatId', 'messageThreadId'],
    ['sendSilently']
  );
  if ('error' in parsedBody) {
    return res.status(parsedBody.error.status).json(parsedBody.error);
  }
  const body = parsedBody.value;

  settings.notifications.agents.telegram = preserveRedactedSecrets(
    body as NotificationAgentTelegram,
    settings.notifications.agents.telegram
  );
  await settings.save();

  res.status(200).json(redactSecrets(settings.notifications.agents.telegram));
});

notificationRoutes.post('/telegram/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  const parsedBody = parseGenericNotificationBody(
    req.body,
    'Telegram',
    ['botAPI', 'chatId', 'messageThreadId'],
    ['sendSilently']
  );
  if ('error' in parsedBody) {
    return next(parsedBody.error);
  }
  const telegramAgent = new TelegramAgent(
    parsedBody.value as NotificationAgentTelegram
  );
  if (await sendTestNotification(telegramAgent, req.user)) {
    return res.status(204).send();
  } else {
    return next({
      status: 500,
      message: 'Failed to send Telegram notification.',
    });
  }
});

notificationRoutes.get('/pushbullet', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.notifications.agents.pushbullet));
});

notificationRoutes.post('/pushbullet', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseGenericNotificationBody(req.body, 'Pushbullet', [
    'accessToken',
  ]);
  if ('error' in parsedBody) {
    return res.status(parsedBody.error.status).json(parsedBody.error);
  }
  const body = parsedBody.value;

  settings.notifications.agents.pushbullet = preserveRedactedSecrets(
    body as NotificationAgentPushbullet,
    settings.notifications.agents.pushbullet
  );
  await settings.save();

  res.status(200).json(redactSecrets(settings.notifications.agents.pushbullet));
});

notificationRoutes.post('/pushbullet/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  const parsedBody = parseGenericNotificationBody(req.body, 'Pushbullet', [
    'accessToken',
  ]);
  if ('error' in parsedBody) {
    return next(parsedBody.error);
  }
  const pushbulletAgent = new PushbulletAgent(
    parsedBody.value as NotificationAgentPushbullet
  );
  if (await sendTestNotification(pushbulletAgent, req.user)) {
    return res.status(204).send();
  } else {
    return next({
      status: 500,
      message: 'Failed to send Pushbullet notification.',
    });
  }
});

notificationRoutes.get('/pushover', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.notifications.agents.pushover));
});

notificationRoutes.post('/pushover', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseGenericNotificationBody(req.body, 'Pushover', [
    'accessToken',
    'userToken',
    'sound',
  ]);
  if ('error' in parsedBody) {
    return res.status(parsedBody.error.status).json(parsedBody.error);
  }
  const body = parsedBody.value;

  settings.notifications.agents.pushover = preserveRedactedSecrets(
    body as NotificationAgentPushover,
    settings.notifications.agents.pushover
  );
  await settings.save();

  res.status(200).json(redactSecrets(settings.notifications.agents.pushover));
});

notificationRoutes.post('/pushover/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  const parsedBody = parseGenericNotificationBody(req.body, 'Pushover', [
    'accessToken',
    'userToken',
    'sound',
  ]);
  if ('error' in parsedBody) {
    return next(parsedBody.error);
  }
  const pushoverAgent = new PushoverAgent(
    parsedBody.value as NotificationAgentPushover
  );
  if (await sendTestNotification(pushoverAgent, req.user)) {
    return res.status(204).send();
  } else {
    return next({
      status: 500,
      message: 'Failed to send Pushover notification.',
    });
  }
});

notificationRoutes.get('/email', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.notifications.agents.email));
});

notificationRoutes.post('/email', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseGenericNotificationBody(
    req.body,
    'Email',
    ['emailFrom', 'smtpHost', 'senderName'],
    [
      'userEmailRequired',
      'secure',
      'ignoreTls',
      'requireTls',
      'allowSelfSigned',
    ],
    ['smtpPort']
  );
  if ('error' in parsedBody) {
    return res.status(parsedBody.error.status).json(parsedBody.error);
  }
  const body = parsedBody.value;

  settings.notifications.agents.email = preserveRedactedSecrets(
    body as NotificationAgentEmail,
    settings.notifications.agents.email
  );
  await settings.save();

  res.status(200).json(redactSecrets(settings.notifications.agents.email));
});

notificationRoutes.post('/email/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  const parsedBody = parseGenericNotificationBody(
    req.body,
    'Email',
    ['emailFrom', 'smtpHost', 'senderName'],
    [
      'userEmailRequired',
      'secure',
      'ignoreTls',
      'requireTls',
      'allowSelfSigned',
    ],
    ['smtpPort']
  );
  if ('error' in parsedBody) {
    return next(parsedBody.error);
  }
  const emailAgent = new EmailAgent(parsedBody.value as NotificationAgentEmail);
  if (await sendTestNotification(emailAgent, req.user)) {
    return res.status(204).send();
  } else {
    return next({
      status: 500,
      message: 'Failed to send email notification.',
    });
  }
});

notificationRoutes.get('/webpush', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.notifications.agents.webpush));
});

notificationRoutes.post('/webpush', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseGenericNotificationBody(req.body, 'Web push');
  if ('error' in parsedBody) {
    return res.status(parsedBody.error.status).json(parsedBody.error);
  }
  const body = parsedBody.value;

  settings.notifications.agents.webpush = preserveRedactedSecrets(
    body as NotificationAgentConfig,
    settings.notifications.agents.webpush
  );
  await settings.save();

  res.status(200).json(redactSecrets(settings.notifications.agents.webpush));
});

notificationRoutes.post('/webpush/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  const parsedBody = parseGenericNotificationBody(req.body, 'Web push');
  if ('error' in parsedBody) {
    return next(parsedBody.error);
  }
  const webpushAgent = new WebPushAgent(
    parsedBody.value as NotificationAgentConfig
  );
  if (await sendTestNotification(webpushAgent, req.user)) {
    return res.status(204).send();
  } else {
    return next({
      status: 500,
      message: 'Failed to send web push notification.',
    });
  }
});

notificationRoutes.get('/webhook', (_req, res) => {
  const settings = getSettings();

  const webhookSettings = settings.notifications.agents.webhook;

  const response: typeof webhookSettings = {
    enabled: webhookSettings.enabled,
    embedPoster: webhookSettings.embedPoster,
    types: webhookSettings.types,
    options: {
      ...webhookSettings.options,
      jsonPayload: JSON.parse(
        Buffer.from(webhookSettings.options.jsonPayload, 'base64').toString(
          'utf8'
        )
      ),
      customHeaders: webhookSettings.options.customHeaders ?? [],
      supportVariables: webhookSettings.options.supportVariables ?? false,
    },
  };

  res.status(200).json(redactSecrets(response));
});

notificationRoutes.post('/webhook', async (req, res, next) => {
  const settings = getSettings();
  try {
    const parsedBody = parseWebhookBody(req.body);
    if ('error' in parsedBody) {
      return next(parsedBody.error);
    }
    const body = parsedBody.value;
    const payloadError = validateWebhookPayload(body.options.jsonPayload);
    const headerError = validateWebhookHeaders(body.options.customHeaders);
    if (payloadError) {
      return next(payloadError);
    }
    if (headerError) {
      return next(headerError);
    }
    const customHeaders = (body.options.customHeaders ?? []) as {
      key: string;
      value: string;
    }[];

    const validationError = body.enabled
      ? await validateNotificationUrl(body.options.webhookUrl, 'Webhook URL', {
          allowTemplates: body.options.supportVariables,
        })
      : undefined;

    if (validationError) {
      return next(validationError);
    }

    settings.notifications.agents.webhook = preserveRedactedSecrets(
      {
        enabled: body.enabled,
        embedPoster: body.embedPoster,
        types: body.types,
        options: {
          jsonPayload: Buffer.from(
            JSON.stringify(body.options.jsonPayload)
          ).toString('base64'),
          webhookUrl: body.options.webhookUrl,
          authHeader: body.options.authHeader,
          customHeaders,
          supportVariables: body.options.supportVariables,
        },
      },
      settings.notifications.agents.webhook
    );
    await settings.save();

    res.status(200).json(redactSecrets(settings.notifications.agents.webhook));
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

notificationRoutes.post('/webhook/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  try {
    const parsedBody = parseWebhookBody(req.body);
    if ('error' in parsedBody) {
      return next(parsedBody.error);
    }
    const body = parsedBody.value;
    const payloadError = validateWebhookPayload(body.options.jsonPayload);
    const headerError = validateWebhookHeaders(body.options.customHeaders);
    if (payloadError) {
      return next(payloadError);
    }
    if (headerError) {
      return next(headerError);
    }
    const customHeaders = (body.options.customHeaders ?? []) as {
      key: string;
      value: string;
    }[];

    const validationError = await validateNotificationUrl(
      body.options.webhookUrl,
      'Webhook URL',
      { allowTemplates: body.options.supportVariables }
    );

    if (validationError) {
      return next(validationError);
    }

    const testBody = {
      enabled: body.enabled,
      embedPoster: body.embedPoster,
      types: body.types,
      options: {
        jsonPayload: Buffer.from(
          JSON.stringify(body.options.jsonPayload)
        ).toString('base64'),
        webhookUrl: body.options.webhookUrl,
        authHeader: body.options.authHeader,
        customHeaders,
        supportVariables: body.options.supportVariables,
      },
    };

    const webhookAgent = new WebhookAgent(testBody);
    if (await sendTestNotification(webhookAgent, req.user)) {
      return res.status(204).send();
    } else {
      return next({
        status: 500,
        message: 'Failed to send webhook notification.',
      });
    }
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

notificationRoutes.get('/gotify', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.notifications.agents.gotify));
});

notificationRoutes.post('/gotify', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseUrlNotificationBody(req.body, 'Gotify');
  if ('error' in parsedBody) {
    return res.status(parsedBody.error.status).json(parsedBody.error);
  }
  const body = parsedBody.value;
  const validationError = body.enabled
    ? await validateNotificationUrl(body.options.url, 'Gotify URL')
    : undefined;

  if (validationError) {
    return res.status(validationError.status).json(validationError);
  }

  settings.notifications.agents.gotify = preserveRedactedSecrets(
    body as NotificationAgentGotify,
    settings.notifications.agents.gotify
  );
  await settings.save();

  res.status(200).json(redactSecrets(settings.notifications.agents.gotify));
});

notificationRoutes.post('/gotify/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  const parsedBody = parseUrlNotificationBody(req.body, 'Gotify');
  if ('error' in parsedBody) {
    return next(parsedBody.error);
  }
  const body = parsedBody.value;

  const validationError = await validateNotificationUrl(
    body.options.url,
    'Gotify URL'
  );

  if (validationError) {
    return next(validationError);
  }

  const gotifyAgent = new GotifyAgent(body as NotificationAgentGotify);
  if (await sendTestNotification(gotifyAgent, req.user)) {
    return res.status(204).send();
  } else {
    return next({
      status: 500,
      message: 'Failed to send Gotify notification.',
    });
  }
});

notificationRoutes.get('/ntfy', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.notifications.agents.ntfy));
});

notificationRoutes.post('/ntfy', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseUrlNotificationBody(req.body, 'ntfy');
  if ('error' in parsedBody) {
    return res.status(parsedBody.error.status).json(parsedBody.error);
  }
  const body = parsedBody.value;
  const validationError = body.enabled
    ? await validateNotificationUrl(body.options.url, 'ntfy URL')
    : undefined;

  if (validationError) {
    return res.status(validationError.status).json(validationError);
  }

  settings.notifications.agents.ntfy = preserveRedactedSecrets(
    body as NotificationAgentNtfy,
    settings.notifications.agents.ntfy
  );
  await settings.save();

  res.status(200).json(redactSecrets(settings.notifications.agents.ntfy));
});

notificationRoutes.post('/ntfy/test', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 500,
      message: 'User information is missing from the request.',
    });
  }

  const parsedBody = parseUrlNotificationBody(req.body, 'ntfy');
  if ('error' in parsedBody) {
    return next(parsedBody.error);
  }
  const body = parsedBody.value;

  const validationError = await validateNotificationUrl(
    body.options.url,
    'ntfy URL'
  );

  if (validationError) {
    return next(validationError);
  }

  const ntfyAgent = new NtfyAgent(body as NotificationAgentNtfy);
  if (await sendTestNotification(ntfyAgent, req.user)) {
    return res.status(204).send();
  } else {
    return next({
      status: 500,
      message: 'Failed to send ntfy notification.',
    });
  }
});

export default notificationRoutes;
