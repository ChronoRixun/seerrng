import { getRepository } from '@server/datasource';
import OverrideRule from '@server/entity/OverrideRule';
import type { OverrideRuleResultsResponse } from '@server/interfaces/api/overrideRuleInterfaces';
import { Permission } from '@server/lib/permissions';
import { isAuthenticated } from '@server/middleware/auth';
import {
  parseBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

const overrideRuleRoutes = Router();
const MAX_OVERRIDE_RULE_STRING_LENGTH = 500;
const MAX_OVERRIDE_RULE_ID = 1_000_000_000;

type OverrideRuleBody = {
  users?: string | null;
  genre?: string | null;
  language?: string | null;
  keywords?: string | null;
  profileId?: number | null;
  rootFolder?: string | null;
  tags?: string | null;
  radarrServiceId?: number | null;
  sonarrServiceId?: number | null;
  lidarrServiceId?: number | null;
};

type OverrideRulePatch = {
  users?: string | null;
  genre?: string | null;
  language?: string | null;
  keywords?: string | null;
  profileId?: number | null;
  rootFolder?: string | null;
  tags?: string | null;
  radarrServiceId?: number | null;
  sonarrServiceId?: number | null;
  lidarrServiceId?: number | null;
};

type OverrideRuleErrorResponse = { status: number; message: string };
type OverrideRuleResponse = OverrideRule | OverrideRuleErrorResponse;
type OverrideRuleRequest<P = Record<string, string>> = Request<
  P,
  OverrideRuleResponse,
  OverrideRuleBody
>;

const parseOverrideRuleRouteId = (id: unknown): number | undefined => {
  const parsedValue =
    typeof id === 'string' && id.trim() !== '' ? Number(id) : id;
  const parsed = parseOptionalNonNegativeInteger(
    parsedValue,
    MAX_OVERRIDE_RULE_ID
  );

  return parsed && parsed > 0 ? parsed : undefined;
};

const parseOptionalRuleString = (
  value: unknown,
  fieldName: string
): string | null | undefined | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = parseBoundedString(value, {
    fieldName,
    maxLength: MAX_OVERRIDE_RULE_STRING_LENGTH,
    required: false,
  });

  if ('error' in parsed) {
    return parsed;
  }

  return parsed.value || null;
};

const parseOptionalRuleInteger = (
  value: unknown,
  fieldName: string
): number | null | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = parseOptionalNonNegativeInteger(value, MAX_OVERRIDE_RULE_ID);
  return parsed === undefined
    ? { error: `${fieldName} must be a valid ID.` }
    : parsed;
};

const parseOverrideRuleBody = (
  body: unknown
): OverrideRulePatch | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Override rule body must be an object.' };
  }

  const bodyObject = body as Record<keyof OverrideRuleBody, unknown>;

  const users = parseOptionalRuleString(bodyObject.users, 'Users');
  if (typeof users === 'object' && users && 'error' in users) return users;
  const genre = parseOptionalRuleString(bodyObject.genre, 'Genre');
  if (typeof genre === 'object' && genre && 'error' in genre) return genre;
  const language = parseOptionalRuleString(bodyObject.language, 'Language');
  if (typeof language === 'object' && language && 'error' in language) {
    return language;
  }
  const keywords = parseOptionalRuleString(bodyObject.keywords, 'Keywords');
  if (typeof keywords === 'object' && keywords && 'error' in keywords) {
    return keywords;
  }
  const rootFolder = parseOptionalRuleString(
    bodyObject.rootFolder,
    'Root folder'
  );
  if (typeof rootFolder === 'object' && rootFolder && 'error' in rootFolder) {
    return rootFolder;
  }
  const tags = parseOptionalRuleString(bodyObject.tags, 'Tags');
  if (typeof tags === 'object' && tags && 'error' in tags) return tags;

  const profileId = parseOptionalRuleInteger(
    bodyObject.profileId,
    'Profile ID'
  );
  if (typeof profileId === 'object' && profileId && 'error' in profileId) {
    return profileId;
  }
  const radarrServiceId = parseOptionalRuleInteger(
    bodyObject.radarrServiceId,
    'Radarr service ID'
  );
  if (
    typeof radarrServiceId === 'object' &&
    radarrServiceId &&
    'error' in radarrServiceId
  ) {
    return radarrServiceId;
  }
  const sonarrServiceId = parseOptionalRuleInteger(
    bodyObject.sonarrServiceId,
    'Sonarr service ID'
  );
  if (
    typeof sonarrServiceId === 'object' &&
    sonarrServiceId &&
    'error' in sonarrServiceId
  ) {
    return sonarrServiceId;
  }
  const lidarrServiceId = parseOptionalRuleInteger(
    bodyObject.lidarrServiceId,
    'Lidarr service ID'
  );
  if (
    typeof lidarrServiceId === 'object' &&
    lidarrServiceId &&
    'error' in lidarrServiceId
  ) {
    return lidarrServiceId;
  }

  return {
    users,
    genre,
    language,
    keywords,
    profileId,
    rootFolder,
    tags,
    radarrServiceId,
    sonarrServiceId,
    lidarrServiceId,
  };
};

overrideRuleRoutes.get(
  '/',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const overrideRuleRepository = getRepository(OverrideRule);

    try {
      const rules = await overrideRuleRepository.find({});

      return res.status(200).json(rules as OverrideRuleResultsResponse);
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

overrideRuleRoutes.post(
  '/',
  isAuthenticated(Permission.ADMIN),
  async (
    req: OverrideRuleRequest,
    res: Response<OverrideRuleResponse>,
    next: NextFunction
  ) => {
    const overrideRuleRepository = getRepository(OverrideRule);
    const parsedBody = parseOverrideRuleBody(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ status: 400, message: parsedBody.error });
    }

    try {
      const rule = new OverrideRule();
      Object.assign(rule, parsedBody);

      const newRule = await overrideRuleRepository.save(rule);

      return res.status(200).json(newRule);
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

overrideRuleRoutes.put(
  '/:ruleId',
  isAuthenticated(Permission.ADMIN),
  async (
    req: OverrideRuleRequest<{ ruleId: string }>,
    res: Response<OverrideRuleResponse>,
    next: NextFunction
  ) => {
    const overrideRuleRepository = getRepository(OverrideRule);
    const ruleId = parseOverrideRuleRouteId(req.params.ruleId);
    if (!ruleId) {
      return next({ status: 404, message: 'Override Rule not found.' });
    }

    const parsedBody = parseOverrideRuleBody(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ status: 400, message: parsedBody.error });
    }

    try {
      const rule = await overrideRuleRepository.findOne({
        where: {
          id: ruleId,
        },
      });

      if (!rule) {
        return next({ status: 404, message: 'Override Rule not found.' });
      }

      Object.assign(rule, parsedBody);

      const newRule = await overrideRuleRepository.save(rule);

      return res.status(200).json(newRule);
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

overrideRuleRoutes.delete<
  { ruleId: string },
  OverrideRule | { status: number; message: string }
>('/:ruleId', isAuthenticated(Permission.ADMIN), async (req, res, next) => {
  const overrideRuleRepository = getRepository(OverrideRule);
  const ruleId = parseOverrideRuleRouteId(req.params.ruleId);
  if (!ruleId) {
    return next({ status: 404, message: 'Override Rule not found.' });
  }

  try {
    const rule = await overrideRuleRepository.findOne({
      where: {
        id: ruleId,
      },
    });

    if (!rule) {
      return next({ status: 404, message: 'Override Rule not found.' });
    }

    await overrideRuleRepository.remove(rule);

    return res.status(200).json(rule);
  } catch (e) {
    next({ status: 404, message: e.message });
  }
});

export default overrideRuleRoutes;
