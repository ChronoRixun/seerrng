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
import { getSettings } from '@server/lib/settings';
import type { AvailableLocale } from '@server/types/languages';
import {
  isSafeHttpUrl,
  preserveRedactedSecrets,
  redactSecrets,
} from '@server/utils/security';
import { Router } from 'express';

const notificationRoutes = Router();
const MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1024;
const MAX_WEBHOOK_CUSTOM_HEADERS = 20;
const MAX_WEBHOOK_HEADER_VALUE_LENGTH = 4096;
const WEBHOOK_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const messages = defineMessages('notifications.test', {
  subject: 'Test Notification',
  message: 'Check check, 1, 2, 3. Are we coming in clear?',
});

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
  const validationError = req.body.enabled
    ? await validateNotificationUrl(
        req.body.options?.webhookUrl,
        'Discord webhook URL'
      )
    : undefined;

  if (validationError) {
    return res.status(validationError.status).json(validationError);
  }

  settings.notifications.agents.discord = preserveRedactedSecrets(
    req.body,
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

  const validationError = await validateNotificationUrl(
    req.body.options?.webhookUrl,
    'Discord webhook URL'
  );

  if (validationError) {
    return next(validationError);
  }

  const discordAgent = new DiscordAgent(req.body);
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
  const validationError = req.body.enabled
    ? await validateNotificationUrl(
        req.body.options?.webhookUrl,
        'Slack webhook URL'
      )
    : undefined;

  if (validationError) {
    return res.status(validationError.status).json(validationError);
  }

  settings.notifications.agents.slack = preserveRedactedSecrets(
    req.body,
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

  const validationError = await validateNotificationUrl(
    req.body.options?.webhookUrl,
    'Slack webhook URL'
  );

  if (validationError) {
    return next(validationError);
  }

  const slackAgent = new SlackAgent(req.body);
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

  settings.notifications.agents.telegram = preserveRedactedSecrets(
    req.body,
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

  const telegramAgent = new TelegramAgent(req.body);
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

  settings.notifications.agents.pushbullet = preserveRedactedSecrets(
    req.body,
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

  const pushbulletAgent = new PushbulletAgent(req.body);
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

  settings.notifications.agents.pushover = preserveRedactedSecrets(
    req.body,
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

  const pushoverAgent = new PushoverAgent(req.body);
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

  settings.notifications.agents.email = preserveRedactedSecrets(
    req.body,
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

  const emailAgent = new EmailAgent(req.body);
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

  settings.notifications.agents.webpush = preserveRedactedSecrets(
    req.body,
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

  const webpushAgent = new WebPushAgent(req.body);
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
    const payloadError = validateWebhookPayload(req.body.options?.jsonPayload);
    const headerError = validateWebhookHeaders(req.body.options?.customHeaders);
    if (payloadError) {
      return next(payloadError);
    }
    if (headerError) {
      return next(headerError);
    }

    const validationError = req.body.enabled
      ? await validateNotificationUrl(
          req.body.options?.webhookUrl,
          'Webhook URL',
          {
          allowTemplates: req.body.options?.supportVariables === true,
          }
        )
      : undefined;

    if (validationError) {
      return next(validationError);
    }

    settings.notifications.agents.webhook = preserveRedactedSecrets(
      {
        enabled: req.body.enabled,
        embedPoster: req.body.embedPoster,
        types: req.body.types,
        options: {
          jsonPayload: Buffer.from(
            JSON.stringify(req.body.options.jsonPayload)
          ).toString('base64'),
          webhookUrl: req.body.options.webhookUrl,
          authHeader: req.body.options.authHeader,
          customHeaders: req.body.options.customHeaders ?? [],
          supportVariables: req.body.options.supportVariables ?? false,
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
    const payloadError = validateWebhookPayload(req.body.options?.jsonPayload);
    const headerError = validateWebhookHeaders(req.body.options?.customHeaders);
    if (payloadError) {
      return next(payloadError);
    }
    if (headerError) {
      return next(headerError);
    }

    const validationError = await validateNotificationUrl(
      req.body.options?.webhookUrl,
      'Webhook URL',
      { allowTemplates: req.body.options?.supportVariables === true }
    );

    if (validationError) {
      return next(validationError);
    }

    const testBody = {
      enabled: req.body.enabled,
      embedPoster: req.body.embedPoster,
      types: req.body.types,
      options: {
        jsonPayload: Buffer.from(
          JSON.stringify(req.body.options.jsonPayload)
        ).toString('base64'),
        webhookUrl: req.body.options.webhookUrl,
        authHeader: req.body.options.authHeader,
        customHeaders: req.body.options.customHeaders ?? [],
        supportVariables: req.body.options.supportVariables ?? false,
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
  const validationError = req.body.enabled
    ? await validateNotificationUrl(req.body.options?.url, 'Gotify URL')
    : undefined;

  if (validationError) {
    return res.status(validationError.status).json(validationError);
  }

  settings.notifications.agents.gotify = preserveRedactedSecrets(
    req.body,
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

  const validationError = await validateNotificationUrl(
    req.body.options?.url,
    'Gotify URL'
  );

  if (validationError) {
    return next(validationError);
  }

  const gotifyAgent = new GotifyAgent(req.body);
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
  const validationError = req.body.enabled
    ? await validateNotificationUrl(req.body.options?.url, 'ntfy URL')
    : undefined;

  if (validationError) {
    return res.status(validationError.status).json(validationError);
  }

  settings.notifications.agents.ntfy = preserveRedactedSecrets(
    req.body,
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

  const validationError = await validateNotificationUrl(
    req.body.options?.url,
    'ntfy URL'
  );

  if (validationError) {
    return next(validationError);
  }

  const ntfyAgent = new NtfyAgent(req.body);
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
