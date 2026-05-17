import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import TautulliAPI from '@server/api/tautulli';
import { MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { USER_SETTINGS_LIMITS } from '@server/constants/userSettings';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserPushSubscription } from '@server/entity/UserPushSubscription';
import type { WatchlistResponse } from '@server/interfaces/api/discoverInterfaces';
import type {
  QuotaResponse,
  UserRequestsResponse,
  UserResultsResponse,
  UserWatchDataResponse,
} from '@server/interfaces/api/userInterfaces';
import {
  MAX_PERMISSION_VALUE,
  Permission,
  hasPermission,
} from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { getCombinedWatchlist } from '@server/lib/watchlist';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import {
  parseNonNegativeInt,
  parsePageParams,
  parsePositiveInt,
} from '@server/utils/pagination';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import { resolvesToLocalOrPrivateAddress } from '@server/utils/security';
import {
  parseBoundedString,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router } from 'express';
import gravatarUrl from 'gravatar-url';
import { findIndex, sortBy } from 'lodash';
import type { EntityManager } from 'typeorm';
import { In, Not } from 'typeorm';
import userSettingsRoutes from './usersettings';

const router = Router();
const MAX_USER_SEARCH_QUERY_LENGTH = 200;
const MAX_USER_SORT_LENGTH = 40;

const parseOptionalUserQueryString = (
  value: unknown,
  fieldName: string,
  maxLength: number
) =>
  parseOptionalBoundedString(value, {
    fieldName,
    maxLength,
  });
const MAX_BULK_USER_IDS = 250;
const MAX_PROVIDER_IMPORT_IDS = 250;
const MAX_PUSH_ENDPOINT_LENGTH = 2048;
const MAX_PUSH_KEY_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_USER_ID_VALUE = 1_000_000_000;
const MAX_WATCHLIST_PAGE = 500;

const parseStringArray = (
  value: unknown,
  options: {
    fieldName: string;
    maxItems: number;
    maxItemLength: number;
    required?: boolean;
  }
): { value: string[] } | { error: string } => {
  if (value === undefined && options.required === false) {
    return { value: [] };
  }

  if (!Array.isArray(value) || value.length > options.maxItems) {
    return { error: `${options.fieldName} is invalid.` };
  }

  const parsedValues = new Set<string>();

  for (const item of value) {
    const parsed = parseBoundedString(item, {
      fieldName: options.fieldName,
      maxLength: options.maxItemLength,
    });

    if ('error' in parsed) {
      return parsed;
    }

    parsedValues.add(parsed.value);
  }

  return { value: [...parsedValues] };
};

const parsePositiveIntegerArray = (
  value: unknown,
  options: { fieldName: string; maxItems: number }
): { value: number[] } | { error: string } => {
  if (!Array.isArray(value) || value.length > options.maxItems) {
    return { error: `${options.fieldName} is invalid.` };
  }

  const parsedValues = new Set<number>();

  for (const item of value) {
    const parsed = parseOptionalNonNegativeInteger(Number(item));

    if (!parsed || parsed < 1) {
      return { error: `${options.fieldName} contains an invalid id.` };
    }

    parsedValues.add(parsed);
  }

  return { value: [...parsedValues] };
};

const parseUserRouteId = (id: unknown): number | undefined => {
  const parsedValue =
    typeof id === 'string' && id.trim() !== '' ? Number(id) : id;
  const parsed = parseOptionalNonNegativeInteger(
    parsedValue,
    MAX_USER_ID_VALUE
  );

  return parsed && parsed > 0 ? parsed : undefined;
};

const parseOptionalIncludeUserIds = (
  value: unknown
): { value: number[] } | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return { value: [] };
  }

  const values = Array.isArray(value)
    ? value.flatMap((item) => String(item).split(','))
    : String(value).split(',');

  return parsePositiveIntegerArray(values, {
    fieldName: 'includeIds',
    maxItems: MAX_BULK_USER_IDS,
  });
};

const parseUserBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'User body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
};

const parseOptionalUserBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (body === undefined || body === null) {
    return { value: {} };
  }

  return parseUserBodyObject(body);
};

const validatePushSubscriptionEndpoint = async (
  endpoint: string
): Promise<{ value: string } | { error: string }> => {
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return { error: 'endpoint must be a valid URL.' };
  }

  if (parsedEndpoint.protocol !== 'https:') {
    return { error: 'endpoint must be an HTTPS URL.' };
  }

  if (parsedEndpoint.username || parsedEndpoint.password) {
    return { error: 'endpoint must not include credentials.' };
  }

  if (
    process.env.SEERR_ALLOW_PRIVATE_PUSH_ENDPOINTS !== 'true' &&
    (await resolvesToLocalOrPrivateAddress(parsedEndpoint.hostname))
  ) {
    return { error: 'endpoint must be a public HTTPS URL.' };
  }

  return { value: endpoint };
};

const parsePushSubscriptionBody = async (
  body: unknown
): Promise<
  | {
      value: Pick<
        UserPushSubscription,
        'auth' | 'endpoint' | 'p256dh' | 'userAgent'
      >;
    }
  | { error: string }
> => {
  const parsedBody = parseUserBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const endpoint = parseBoundedString(parsedBody.value.endpoint, {
    fieldName: 'endpoint',
    maxLength: MAX_PUSH_ENDPOINT_LENGTH,
  });

  if ('error' in endpoint) {
    return endpoint;
  }

  const validatedEndpoint = await validatePushSubscriptionEndpoint(
    endpoint.value
  );
  if ('error' in validatedEndpoint) {
    return validatedEndpoint;
  }

  const auth = parseBoundedString(parsedBody.value.auth, {
    fieldName: 'auth',
    maxLength: MAX_PUSH_KEY_LENGTH,
  });

  if ('error' in auth) {
    return auth;
  }

  const p256dh = parseBoundedString(parsedBody.value.p256dh, {
    fieldName: 'p256dh',
    maxLength: MAX_PUSH_KEY_LENGTH,
  });

  if ('error' in p256dh) {
    return p256dh;
  }

  const userAgent = parseOptionalBoundedString(parsedBody.value.userAgent, {
    fieldName: 'userAgent',
    maxLength: MAX_USER_AGENT_LENGTH,
  });

  if ('error' in userAgent) {
    return userAgent;
  }

  return {
    value: {
      auth: auth.value,
      endpoint: validatedEndpoint.value,
      p256dh: p256dh.value,
      userAgent: userAgent.value ?? '',
    },
  };
};

const parsePushSubscriptionEndpointParam = async (
  value: unknown
): Promise<{ value: string } | { error: string }> => {
  const endpoint = parseBoundedString(value, {
    fieldName: 'endpoint',
    maxLength: MAX_PUSH_ENDPOINT_LENGTH,
  });

  if ('error' in endpoint) {
    return endpoint;
  }

  return validatePushSubscriptionEndpoint(endpoint.value);
};

const parseLocalUserBody = (
  body: unknown
):
  | {
      value: {
        avatar?: string;
        email: string;
        password?: string;
        username: string;
      };
    }
  | { error: string } => {
  const parsedBody = parseUserBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const username = parseBoundedString(parsedBody.value.username, {
    fieldName: 'username',
    maxLength: USER_SETTINGS_LIMITS.username,
  });

  if ('error' in username) {
    return username;
  }

  const email = parseOptionalBoundedString(parsedBody.value.email, {
    fieldName: 'email',
    maxLength: USER_SETTINGS_LIMITS.email,
  });

  if ('error' in email) {
    return email;
  }

  const password = parseOptionalBoundedString(parsedBody.value.password, {
    fieldName: 'password',
    maxLength: USER_SETTINGS_LIMITS.password,
  });

  if ('error' in password) {
    return password;
  }

  if (password.value !== undefined && password.value.length < 8) {
    return { error: 'password must be at least 8 characters long.' };
  }

  const avatar = parseOptionalBoundedString(parsedBody.value.avatar, {
    fieldName: 'avatar',
    maxLength: USER_SETTINGS_LIMITS.avatar,
  });

  if ('error' in avatar) {
    return avatar;
  }

  return {
    value: {
      avatar: avatar.value,
      email: email.value ?? username.value,
      password: password.value,
      username: username.value,
    },
  };
};

const parseUserUpdateBody = (
  body: unknown
):
  | {
      value: {
        permissions: number;
        username: string;
      };
    }
  | { error: string } => {
  const parsedBody = parseUserBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const username = parseBoundedString(parsedBody.value.username, {
    fieldName: 'username',
    maxLength: USER_SETTINGS_LIMITS.username,
  });

  if ('error' in username) {
    return username;
  }

  const permissions = parseOptionalNonNegativeInteger(
    parsedBody.value.permissions,
    MAX_PERMISSION_VALUE
  );

  if (permissions === undefined) {
    return { error: 'permissions is invalid.' };
  }

  return { value: { permissions, username: username.value } };
};

const filterPushSubscription = (subscription: UserPushSubscription) => ({
  endpoint: subscription.endpoint,
  userAgent: subscription.userAgent,
  createdAt: subscription.createdAt,
});

router.get(
  '/',
  isAuthenticated([Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS], {
    type: 'or',
  }),
  async (req, res, next) => {
    try {
      const parsedIncludeIds = parseOptionalIncludeUserIds(
        req.query.includeIds
      );
      if ('error' in parsedIncludeIds) {
        return next({ status: 400, message: parsedIncludeIds.error });
      }
      const includeIds = parsedIncludeIds.value;
      const pageSize = parsePositiveInt(
        req.query.take,
        Math.max(10, includeIds.length),
        100
      );
      const skip = parseNonNegativeInt(req.query.skip);
      const parsedQ = parseOptionalUserQueryString(
        req.query.q,
        'Search query',
        MAX_USER_SEARCH_QUERY_LENGTH
      );
      if ('error' in parsedQ) {
        return next({ status: 400, message: parsedQ.error });
      }
      const parsedSort = parseOptionalUserQueryString(
        req.query.sort,
        'Sort field',
        MAX_USER_SORT_LENGTH
      );
      if ('error' in parsedSort) {
        return next({ status: 400, message: parsedSort.error });
      }
      const parsedSortDirection = parseOptionalUserQueryString(
        req.query.sortDirection,
        'Sort direction',
        MAX_USER_SORT_LENGTH
      );
      if ('error' in parsedSortDirection) {
        return next({ status: 400, message: parsedSortDirection.error });
      }

      const q = parsedQ.value?.toLowerCase() ?? '';
      const sortParam = parsedSort.value;
      const sortDirectionQuery = parsedSortDirection.value?.toLowerCase();

      let sortDirection: 'ASC' | 'DESC';
      if (sortDirectionQuery === 'asc') {
        sortDirection = 'ASC';
      } else if (sortDirectionQuery === 'desc') {
        sortDirection = 'DESC';
      } else {
        switch (sortParam) {
          case 'displayname':
            sortDirection = 'ASC';
            break;
          case 'requests':
          case 'updated':
            sortDirection = 'DESC';
            break;
          case 'created':
          case 'usertype':
          case 'role':
          case undefined:
          default:
            sortDirection = 'ASC';
            break;
        }
      }

      let query = getRepository(User).createQueryBuilder('user');

      if (q) {
        query = query.where(
          'LOWER(user.username) LIKE :q OR LOWER(user.email) LIKE :q OR LOWER(user.plexUsername) LIKE :q OR LOWER(user.jellyfinUsername) LIKE :q',
          { q: `%${q}%` }
        );
      }

      if (includeIds.length > 0) {
        query.andWhereInIds(includeIds);
      }

      switch (sortParam) {
        case 'created':
          query = query.orderBy('user.createdAt', sortDirection);
          break;
        case 'updated':
          query = query.orderBy('user.updatedAt', sortDirection);
          break;
        case 'displayname':
          query = query
            .addSelect(
              `CASE WHEN (user.username IS NULL OR user.username = '') THEN (
                CASE WHEN (user.plexUsername IS NULL OR user.plexUsername = '') THEN (
                  CASE WHEN (user.jellyfinUsername IS NULL OR user.jellyfinUsername = '') THEN
                    "user"."email"
                  ELSE
                    LOWER(user.jellyfinUsername)
                  END)
                ELSE
                  LOWER(user.plexUsername)
                END)
              ELSE
                LOWER(user.username)
              END`,
              'displayname_sort_key'
            )
            .orderBy('displayname_sort_key', sortDirection);
          break;
        case 'requests':
          query = query
            .addSelect((subQuery) => {
              return subQuery
                .select('COUNT(request.id)', 'request_count')
                .from(MediaRequest, 'request')
                .where('request.requestedBy.id = user.id');
            }, 'request_count')
            .orderBy('request_count', sortDirection);
          break;
        case 'usertype':
          query = query.orderBy('user.userType', sortDirection);
          break;
        case 'role':
          query = query
            .addSelect(
              `CASE
              WHEN user.id = 1 THEN 0
              WHEN (user.permissions & ${Permission.ADMIN}) != 0 THEN 1
              ELSE 2
            END`,
              'role_sort_key'
            )
            .orderBy('role_sort_key', sortDirection);
          break;
        default:
          query = query.orderBy('user.id', sortDirection);
          break;
      }

      const [users, userCount] = await query
        .take(pageSize)
        .skip(skip)
        .distinct(true)
        .getManyAndCount();

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(userCount / pageSize),
          pageSize,
          results: userCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: User.filterMany(
          users,
          req.user?.hasPermission(Permission.MANAGE_USERS)
        ),
      } as UserResultsResponse);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.post(
  '/',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const parsedBody = parseLocalUserBody(req.body);

    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const body = parsedBody.value;

    try {
      const settings = getSettings();

      const email = body.email;
      const userRepository = getRepository(User);

      const existingUser = await userRepository
        .createQueryBuilder('user')
        .where('user.email = :email', {
          email: email.toLowerCase(),
        })
        .getOne();

      if (existingUser) {
        return next({
          status: 409,
          message: 'User already exists with submitted email.',
          errors: ['USER_EXISTS'],
        });
      }

      const passedExplicitPassword = !!body.password;
      const avatar = gravatarUrl(email, { default: 'mm', size: 200 });

      if (
        !passedExplicitPassword &&
        !settings.notifications.agents.email.enabled
      ) {
        throw new Error('Email notifications must be enabled');
      }

      const user = new User({
        email,
        avatar: body.avatar ?? avatar,
        username: body.username,
        password: body.password,
        permissions: settings.main.defaultPermissions,
        plexToken: '',
        userType: UserType.LOCAL,
      });

      if (passedExplicitPassword) {
        await user?.setPassword(body.password ?? '');
      } else {
        await user?.generatePassword();
      }

      await userRepository.save(user);
      return res.status(201).json(user.filter());
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.post<
  never,
  unknown,
  {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string;
  }
>('/registerPushSubscription', async (req, res, next) => {
  const parsedBody = await parsePushSubscriptionBody(req.body);

  if ('error' in parsedBody) {
    return next({ status: 400, message: parsedBody.error });
  }

  const body = parsedBody.value;

  try {
    // This prevents race conditions where two requests both pass the checks
    await dataSource.transaction(
      async (transactionalEntityManager: EntityManager) => {
        const transactionalRepo =
          transactionalEntityManager.getRepository(UserPushSubscription);

        // Check for existing subscription by auth or endpoint within transaction
        const existingSubscription = await transactionalRepo.findOne({
          relations: { user: true },
          where: [
            { auth: body.auth, user: { id: req.user?.id } },
            { endpoint: body.endpoint, user: { id: req.user?.id } },
          ],
        });

        if (existingSubscription) {
          // If endpoint matches but auth is different, update with new keys (iOS refresh case)
          if (
            existingSubscription.endpoint === body.endpoint &&
            existingSubscription.auth !== body.auth
          ) {
            existingSubscription.auth = body.auth;
            existingSubscription.p256dh = body.p256dh;
            existingSubscription.userAgent = body.userAgent;

            await transactionalRepo.save(existingSubscription);

            logger.debug(
              'Updated existing push subscription with new keys for same endpoint.',
              { label: 'API' }
            );
            return;
          }

          logger.debug(
            'Duplicate subscription detected. Skipping registration.',
            { label: 'API' }
          );
          return;
        }

        // Clean up old subscriptions from the same device (userAgent) for this user
        // iOS can silently refresh endpoints, leaving stale subscriptions in the database
        // Only clean up if we're creating a new subscription (not updating an existing one)
        if (body.userAgent) {
          const staleSubscriptions = await transactionalRepo.find({
            relations: { user: true },
            where: {
              userAgent: body.userAgent,
              user: { id: req.user?.id },
              // Only remove subscriptions with different endpoints (stale ones)
              // Keep subscriptions that might be from different browsers/tabs
              endpoint: Not(body.endpoint),
            },
          });

          if (staleSubscriptions.length > 0) {
            await transactionalRepo.remove(staleSubscriptions);
            logger.debug(
              `Removed ${staleSubscriptions.length} stale push subscription(s) from same device.`,
              { label: 'API' }
            );
          }
        }

        const userPushSubscription = new UserPushSubscription({
          auth: body.auth,
          endpoint: body.endpoint,
          p256dh: body.p256dh,
          userAgent: body.userAgent,
          user: req.user,
        });

        await transactionalRepo.save(userPushSubscription);
      }
    );

    return res.status(204).send();
  } catch {
    logger.error('Failed to register user push subscription', {
      label: 'API',
    });
    next({ status: 500, message: 'Failed to register subscription.' });
  }
});

router.get<{ id: string }>(
  '/:id/pushSubscriptions',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User subscriptions not found.' });
      }

      const userPushSubs = await userPushSubRepository.find({
        relations: { user: true },
        where: { user: { id: userId } },
      });

      return res.status(200).json(userPushSubs.map(filterPushSubscription));
    } catch {
      next({ status: 404, message: 'User subscriptions not found.' });
    }
  }
);

router.get<{ id: string; endpoint: string }>(
  '/:id/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User subscription not found.' });
      }

      const endpoint = await parsePushSubscriptionEndpointParam(
        req.params.endpoint
      );
      if ('error' in endpoint) {
        return next({ status: 400, message: endpoint.error });
      }

      const userPushSub = await userPushSubRepository.findOneOrFail({
        relations: {
          user: true,
        },
        where: {
          user: { id: userId },
          endpoint: endpoint.value,
        },
      });

      return res.status(200).json(filterPushSubscription(userPushSub));
    } catch {
      next({ status: 404, message: 'User subscription not found.' });
    }
  }
);

router.delete<{ id: string; endpoint: string }>(
  '/:id/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return res.status(204).send();
      }

      const endpoint = await parsePushSubscriptionEndpointParam(
        req.params.endpoint
      );
      if ('error' in endpoint) {
        return next({ status: 400, message: endpoint.error });
      }

      const userPushSub = await userPushSubRepository.findOne({
        relations: { user: true },
        where: {
          user: { id: userId },
          endpoint: endpoint.value,
        },
      });

      // If not found, just return 204 to prevent push disable failure
      // (rare scenario where user push sub does not exist)
      if (!userPushSub) {
        return res.status(204).send();
      }

      await userPushSubRepository.remove(userPushSub);
      return res.status(204).send();
    } catch (e) {
      logger.error('Something went wrong deleting the user push subcription', {
        label: 'API',
        endpoint: req.params.endpoint?.slice(0, MAX_PUSH_ENDPOINT_LENGTH),
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'User push subcription not found',
      });
    }
  }
);

router.get<{ id: string }>('/:id', async (req, res, next) => {
  try {
    const userRepository = getRepository(User);
    const userId = parseUserRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    const user = await userRepository.findOneOrFail({
      where: { id: userId },
    });

    const isOwnProfile = req.user?.id === user.id;
    const isAdmin = req.user?.hasPermission(Permission.MANAGE_USERS);

    return res.status(200).json(user.filter(isOwnProfile || isAdmin));
  } catch {
    next({ status: 404, message: 'User not found.' });
  }
});

router.get<{ jellyfinUserId: string }>(
  '/jellyfin/:jellyfinUserId',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const jellyfinUserId = normalizeJellyfinGuid(req.params.jellyfinUserId);
      if (!jellyfinUserId) {
        return next({ status: 400, message: 'Invalid Jellyfin User ID.' });
      }

      const user = await userRepository.findOneOrFail({
        where: { jellyfinUserId },
      });

      return res
        .status(200)
        .json(user.filter(req.user?.hasPermission(Permission.MANAGE_USERS)));
    } catch {
      next({ status: 404, message: 'User not found.' });
    }
  }
);

router.use('/:id/settings', userSettingsRoutes);

router.get<{ id: string }, UserRequestsResponse>(
  '/:id/requests',
  async (req, res, next) => {
    const { pageSize, skip } = parsePageParams(req.query, {
      take: 20,
      maxTake: 100,
    });

    try {
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      const user = await getRepository(User).findOne({
        where: { id: userId },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (
        user.id !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: "You do not have permission to view this user's requests.",
        });
      }

      const [requests, requestCount] = await getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.seasons', 'seasons')
        .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
        .leftJoinAndSelect('request.requestedBy', 'requestedBy')
        .andWhere('requestedBy.id = :id', {
          id: user.id,
        })
        .orderBy('request.id', 'DESC')
        .take(pageSize)
        .skip(skip)
        .getManyAndCount();

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(requestCount / pageSize),
          pageSize,
          results: requestCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: filterEntityResponse(requests),
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export const canMakePermissionsChange = (
  permissions: number,
  user?: User
): boolean =>
  // Only let the owner grant admin privileges
  !(hasPermission(Permission.ADMIN, permissions) && user?.id !== 1);

router.put<
  Record<string, never>,
  Partial<User>[],
  { ids: string[]; permissions: number }
>('/', isAuthenticated(Permission.MANAGE_USERS), async (req, res, next) => {
  const parsedBody = parseUserBodyObject(req.body);
  if ('error' in parsedBody) {
    return next({ status: 400, message: parsedBody.error });
  }
  const body = parsedBody.value;

  const parsedIds = parsePositiveIntegerArray(body.ids, {
    fieldName: 'ids',
    maxItems: MAX_BULK_USER_IDS,
  });

  if ('error' in parsedIds) {
    return next({ status: 400, message: parsedIds.error });
  }

  const parsedPermissions = parseOptionalNonNegativeInteger(
    body.permissions,
    MAX_PERMISSION_VALUE
  );

  if (parsedPermissions === undefined) {
    return next({ status: 400, message: 'permissions is invalid.' });
  }

  try {
    const isOwner = req.user?.id === 1;

    if (!canMakePermissionsChange(parsedPermissions, req.user)) {
      return next({
        status: 403,
        message: 'You do not have permission to grant this level of access',
      });
    }

    const userRepository = getRepository(User);

    const users: User[] = await userRepository.find({
      where: {
        id: In(
          isOwner ? parsedIds.value : parsedIds.value.filter((id) => id !== 1)
        ),
      },
    });

    const updatedUsers = await Promise.all(
      users.map(async (user) => {
        return userRepository.save(<User>{
          ...user,
          ...{ permissions: parsedPermissions },
        });
      })
    );

    return res
      .status(200)
      .json(User.filterMany(updatedUsers, req.user?.id === 1));
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

router.put<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const parsedBody = parseUserUpdateBody(req.body);

    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const body = parsedBody.value;

    try {
      const userRepository = getRepository(User);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      const user = await userRepository.findOneOrFail({
        where: { id: userId },
      });

      // Only let the owner user modify themselves
      if (user.id === 1 && req.user?.id !== 1) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this user',
        });
      }

      if (!canMakePermissionsChange(body.permissions, req.user)) {
        return next({
          status: 403,
          message: 'You do not have permission to grant this level of access',
        });
      }

      Object.assign(user, {
        username: body.username,
        permissions: body.permissions,
      });

      await userRepository.save(user);

      return res.status(200).json(user.filter());
    } catch {
      next({ status: 404, message: 'User not found.' });
    }
  }
);

router.delete<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      const user = await userRepository.findOne({
        where: { id: userId },
        relations: { requests: true },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (user.id === 1) {
        return next({
          status: 405,
          message: 'This account cannot be deleted.',
        });
      }

      if (user.hasPermission(Permission.ADMIN) && req.user?.id !== 1) {
        return next({
          status: 405,
          message: 'You cannot delete users with administrative privileges.',
        });
      }

      const requestRepository = getRepository(MediaRequest);

      /**
       * Requests are usually deleted through a cascade constraint. Those however, do
       * not trigger the removal event so listeners to not run and the parent Media
       * will not be updated back to unknown for titles that were still pending. So
       * we manually remove all requests from the user here so the parent media's
       * properly reflect the change.
       */
      await requestRepository.remove(user.requests, {
        /**
         * Break-up into groups of 1000 requests to be removed at a time.
         * Necessary for users with >1000 requests, else an SQLite 'Expression tree is too large' error occurs.
         * https://typeorm.io/repository-api#additional-options
         */
        chunk: user.requests.length / 1000,
      });

      await userRepository.delete(user.id);
      return res.status(200).json(user.filter());
    } catch (e) {
      logger.error('Something went wrong deleting a user', {
        label: 'API',
        userId: req.params.id,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Something went wrong deleting the user',
      });
    }
  }
);

router.post(
  '/import-from-plex',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const parsedBody = parseOptionalUserBodyObject(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const parsedPlexIds = parseStringArray(parsedBody.value.plexIds, {
      fieldName: 'plexIds',
      maxItems: MAX_PROVIDER_IMPORT_IDS,
      maxItemLength: 32,
      required: false,
    });

    if ('error' in parsedPlexIds) {
      return next({ status: 400, message: parsedPlexIds.error });
    }

    try {
      const settings = getSettings();
      const userRepository = getRepository(User);
      const plexIds = parsedPlexIds.value;

      // taken from auth.ts
      const mainUser = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });
      const mainPlexTv = new PlexTvAPI(mainUser.plexToken ?? '');

      const plexUsersResponse = await mainPlexTv.getUsers();
      const createdUsers: User[] = [];
      for (const rawUser of plexUsersResponse.MediaContainer.User) {
        const account = rawUser.$;

        if (account.email) {
          const user = await userRepository
            .createQueryBuilder('user')
            .where('user.plexId = :id', { id: account.id })
            .orWhere('user.email = :email', {
              email: account.email.toLowerCase(),
            })
            .getOne();

          if (user) {
            // Update the user's avatar with their Plex thumbnail, in case it changed
            user.avatar = account.thumb;
            user.email = account.email;
            user.plexUsername = account.username;

            // In case the user was previously a local account
            if (user.userType === UserType.LOCAL) {
              user.userType = UserType.PLEX;
              user.plexId = parseInt(account.id);
            }
            await userRepository.save(user);
          } else if (!plexIds.length || plexIds.includes(account.id)) {
            if (await mainPlexTv.checkUserAccess(parseInt(account.id))) {
              const newUser = new User({
                plexUsername: account.username,
                email: account.email,
                permissions: settings.main.defaultPermissions,
                plexId: parseInt(account.id),
                plexToken: '',
                avatar: account.thumb,
                userType: UserType.PLEX,
              });
              await userRepository.save(newUser);
              createdUsers.push(newUser);
            }
          }
        }
      }

      return res.status(201).json(User.filterMany(createdUsers));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.post(
  '/import-from-jellyfin',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const parsedBody = parseOptionalUserBodyObject(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const parsedJellyfinUserIds = parseStringArray(
      parsedBody.value.jellyfinUserIds,
      {
        fieldName: 'jellyfinUserIds',
        maxItems: MAX_PROVIDER_IMPORT_IDS,
        maxItemLength: 128,
      }
    );

    if ('error' in parsedJellyfinUserIds) {
      return next({ status: 400, message: parsedJellyfinUserIds.error });
    }

    try {
      const settings = getSettings();
      const userRepository = getRepository(User);

      // taken from auth.ts
      const admin = await userRepository.findOneOrFail({
        where: { id: 1 },
        select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
        order: { id: 'ASC' },
      });

      const hostname = getHostname();
      const jellyfinClient = new JellyfinAPI(
        hostname,
        settings.jellyfin.apiKey,
        admin.jellyfinDeviceId ?? ''
      );
      jellyfinClient.setUserId(admin.jellyfinUserId ?? '');

      //const jellyfinUsersResponse = await jellyfinClient.getUsers();
      const createdUsers: User[] = [];

      jellyfinClient.setUserId(admin.jellyfinUserId ?? '');
      const jellyfinUsers = await jellyfinClient.getUsers();

      const jellyfinUsersById = new Map(
        jellyfinUsers.users.map((user) => [
          normalizeJellyfinGuid(user.Id),
          user,
        ])
      );

      for (const rawJellyfinUserId of parsedJellyfinUserIds.value) {
        const jellyfinUserId = normalizeJellyfinGuid(rawJellyfinUserId);
        if (!jellyfinUserId) {
          continue;
        }

        const jellyfinUser = jellyfinUsersById.get(jellyfinUserId);

        const user = await userRepository.findOne({
          select: ['id', 'jellyfinUserId'],
          where: { jellyfinUserId: jellyfinUserId },
        });

        if (!user) {
          const newUser = new User({
            jellyfinUsername: jellyfinUser?.Name,
            jellyfinUserId: jellyfinUser?.Id,
            jellyfinDeviceId: Buffer.from(
              `BOT_seerr_${jellyfinUser?.Name ?? ''}`
            ).toString('base64'),
            email: jellyfinUser?.Name,
            permissions: settings.main.defaultPermissions,
            avatar: `/avatarproxy/${jellyfinUser?.Id}`,
            userType:
              settings.main.mediaServerType === MediaServerType.JELLYFIN
                ? UserType.JELLYFIN
                : UserType.EMBY,
          });

          await userRepository.save(newUser);
          createdUsers.push(newUser);
        }
      }
      return res.status(201).json(User.filterMany(createdUsers));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.get<{ id: string }, QuotaResponse>(
  '/:id/quota',
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (
        userId !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'and' }
        )
      ) {
        return next({
          status: 403,
          message:
            "You do not have permission to view this user's request limits.",
        });
      }

      const user = await userRepository.findOneOrFail({
        where: { id: userId },
      });

      const quotas = await user.getQuota();

      return res.status(200).json(quotas);
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

router.get<{ id: string }, UserWatchDataResponse>(
  '/:id/watch_data',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const settings = getSettings().tautulli;

    if (!settings.hostname || !settings.port || !settings.apiKey) {
      return next({
        status: 404,
        message: 'Tautulli API not configured.',
      });
    }

    try {
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      const user = await getRepository(User).findOneOrFail({
        where: { id: userId },
        select: { id: true, plexId: true },
      });

      const tautulli = new TautulliAPI(settings);

      const watchStats = await tautulli.getUserWatchStats(user);
      const watchHistory = await tautulli.getUserWatchHistory(user);

      const recentlyWatched = sortBy(
        await getRepository(Media).find({
          where: [
            {
              mediaType: MediaType.MOVIE,
              ratingKey: In(
                watchHistory
                  .filter((record) => record.media_type === 'movie')
                  .map((record) => record.rating_key)
              ),
            },
            {
              mediaType: MediaType.MOVIE,
              ratingKey4k: In(
                watchHistory
                  .filter((record) => record.media_type === 'movie')
                  .map((record) => record.rating_key)
              ),
            },
            {
              mediaType: MediaType.TV,
              ratingKey: In(
                watchHistory
                  .filter((record) => record.media_type === 'episode')
                  .map((record) => record.grandparent_rating_key)
              ),
            },
            {
              mediaType: MediaType.TV,
              ratingKey4k: In(
                watchHistory
                  .filter((record) => record.media_type === 'episode')
                  .map((record) => record.grandparent_rating_key)
              ),
            },
          ],
        }),
        [
          (media) =>
            findIndex(
              watchHistory,
              (record) =>
                (!!media.ratingKey &&
                  parseInt(media.ratingKey) ===
                    (record.media_type === 'movie'
                      ? record.rating_key
                      : record.grandparent_rating_key)) ||
                (!!media.ratingKey4k &&
                  parseInt(media.ratingKey4k) ===
                    (record.media_type === 'movie'
                      ? record.rating_key
                      : record.grandparent_rating_key))
            ),
        ]
      );

      return res.status(200).json({
        recentlyWatched,
        playCount: watchStats.total_plays,
      });
    } catch (e) {
      logger.error('Something went wrong fetching user watch data', {
        label: 'API',
        errorMessage: e.message,
        userId: req.params.id,
      });
      next({
        status: 500,
        message: 'Failed to fetch user watch data.',
      });
    }
  }
);

router.get<{ id: string }, WatchlistResponse>(
  '/:id/watchlist',
  async (req, res, next) => {
    const userId = parseUserRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    if (
      userId !== req.user?.id &&
      !req.user?.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.WATCHLIST_VIEW],
        {
          type: 'or',
        }
      )
    ) {
      return next({
        status: 403,
        message: "You do not have permission to view this user's Watchlist.",
      });
    }

    const itemsPerPage = 20;
    const page = parsePositiveInt(req.query.page, 1, MAX_WATCHLIST_PAGE);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
      select: ['id', 'plexToken'],
    });

    return res.json(
      await getCombinedWatchlist({
        userId: user?.id,
        plexToken: user?.plexToken,
        page,
        itemsPerPage,
      })
    );
  }
);

export default router;
