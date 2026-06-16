import type {
  DVRSettings,
  LidarrSettings,
  RadarrSettings,
  ReadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import {
  normalizeServiceHostname,
  normalizeUrlBase,
} from '@server/utils/serviceUrl';
import {
  parseBoundedString,
  parseOptionalBoolean,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { isValidHttpUrl } from './security';

const MAX_SERVICE_STRING_LENGTH = 512;
const MAX_SERVICE_PATH_LENGTH = 4096;
const MAX_SERVICE_TAGS = 100;
const MAX_SERVICE_PORT = 65535;
const MAX_SERVICE_ID = 1_000_000;

const parseNumberArray = (
  value: unknown,
  fieldName: string
): { value: number[] } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: [] };
  }

  if (!Array.isArray(value) || value.length > MAX_SERVICE_TAGS) {
    return { error: `${fieldName} is invalid.` };
  }

  const parsedValues = new Set<number>();

  for (const item of value) {
    const parsedValue =
      typeof item === 'number'
        ? item
        : typeof item === 'string' && item.trim() !== ''
          ? Number(item)
          : undefined;
    const parsed = parseOptionalNonNegativeInteger(parsedValue, MAX_SERVICE_ID);

    if (parsed === undefined) {
      return { error: `${fieldName} contains an invalid value.` };
    }

    parsedValues.add(parsed);
  }

  return { value: [...parsedValues] };
};

const parseRequiredServiceString = (
  value: unknown,
  fieldName: string,
  maxLength = MAX_SERVICE_STRING_LENGTH
): { value: string } | { error: string } =>
  parseBoundedString(value, { fieldName, maxLength });

const parseOptionalServiceString = (
  value: unknown,
  fieldName: string,
  maxLength = MAX_SERVICE_STRING_LENGTH
): { value: string | undefined } | { error: string } =>
  parseOptionalBoundedString(value, { fieldName, maxLength });

const parseOptionalExternalUrl = (
  value: unknown
): { value: string | undefined } | { error: string } => {
  const parsed = parseOptionalServiceString(value, 'externalUrl');

  if ('error' in parsed || parsed.value === undefined) {
    return parsed;
  }

  return isValidHttpUrl(parsed.value)
    ? parsed
    : { error: 'externalUrl must be a valid HTTP URL.' };
};

const parseOptionalUrlBase = (
  value: unknown
): { value: string | undefined } | { error: string } => {
  const parsed = parseOptionalServiceString(value, 'baseUrl');

  if ('error' in parsed || parsed.value === undefined) {
    return parsed;
  }

  const normalized = normalizeUrlBase(parsed.value);

  return normalized || !parsed.value.trim()
    ? { value: normalized || undefined }
    : { error: 'baseUrl must be a relative path.' };
};

const parseDvrSettings = (
  body: unknown,
  current?: DVRSettings
): { value: DVRSettings } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'settings must be an object.' };
  }

  const settings = body as Partial<DVRSettings>;
  const name = parseRequiredServiceString(settings.name, 'name');
  if ('error' in name) return name;

  const hostname = parseRequiredServiceString(settings.hostname, 'hostname');
  if ('error' in hostname) return hostname;
  const normalizedHostname = normalizeServiceHostname(hostname.value);
  if (!normalizedHostname) {
    return { error: 'hostname is invalid.' };
  }

  const apiKey = parseRequiredServiceString(settings.apiKey, 'apiKey');
  if ('error' in apiKey) return apiKey;

  const activeProfileName = parseRequiredServiceString(
    settings.activeProfileName,
    'activeProfileName'
  );
  if ('error' in activeProfileName) return activeProfileName;

  const activeDirectory = parseRequiredServiceString(
    settings.activeDirectory,
    'activeDirectory',
    MAX_SERVICE_PATH_LENGTH
  );
  if ('error' in activeDirectory) return activeDirectory;

  const baseUrl = parseOptionalUrlBase(settings.baseUrl);
  if ('error' in baseUrl) return baseUrl;

  const externalUrl = parseOptionalExternalUrl(settings.externalUrl);
  if ('error' in externalUrl) return externalUrl;

  const tags = parseNumberArray(settings.tags, 'tags');
  if ('error' in tags) return tags;

  const overrideRule = parseNumberArray(settings.overrideRule, 'overrideRule');
  if ('error' in overrideRule) return overrideRule;

  const port = parseOptionalNonNegativeInteger(settings.port, MAX_SERVICE_PORT);
  const activeProfileId = parseOptionalNonNegativeInteger(
    settings.activeProfileId,
    MAX_SERVICE_ID
  );

  if (port === undefined || port < 1) {
    return { error: 'port is invalid.' };
  }

  if (activeProfileId === undefined) {
    return { error: 'activeProfileId is invalid.' };
  }

  return {
    value: {
      id: current?.id ?? 0,
      name: name.value,
      hostname: normalizedHostname,
      port,
      apiKey: apiKey.value,
      useSsl: parseOptionalBoolean(settings.useSsl) ?? false,
      baseUrl: baseUrl.value,
      activeProfileId,
      activeProfileName: activeProfileName.value,
      activeDirectory: activeDirectory.value,
      tags: tags.value,
      is4k: parseOptionalBoolean(settings.is4k) ?? false,
      isDefault: parseOptionalBoolean(settings.isDefault) ?? false,
      externalUrl: externalUrl.value,
      syncEnabled: parseOptionalBoolean(settings.syncEnabled) ?? false,
      preventSearch: parseOptionalBoolean(settings.preventSearch) ?? false,
      tagRequests: parseOptionalBoolean(settings.tagRequests) ?? false,
      overrideRule: overrideRule.value,
    },
  };
};

export const parseRadarrSettings = (
  body: unknown,
  current?: RadarrSettings
): { value: RadarrSettings } | { error: string } => {
  const parsed = parseDvrSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<RadarrSettings>;

  const minimumAvailability = parseRequiredServiceString(
    settings.minimumAvailability,
    'minimumAvailability'
  );
  if ('error' in minimumAvailability) return minimumAvailability;

  return {
    value: {
      ...parsed.value,
      minimumAvailability: minimumAvailability.value,
    },
  };
};

export const parseSonarrSettings = (
  body: unknown,
  current?: SonarrSettings
): { value: SonarrSettings } | { error: string } => {
  const parsed = parseDvrSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<SonarrSettings>;

  const seriesTypes = ['standard', 'daily', 'anime'] as const;
  const seriesType =
    typeof settings.seriesType === 'string' &&
    seriesTypes.includes(settings.seriesType)
      ? settings.seriesType
      : undefined;
  const animeSeriesType =
    typeof settings.animeSeriesType === 'string' &&
    seriesTypes.includes(settings.animeSeriesType)
      ? settings.animeSeriesType
      : undefined;

  if (!seriesType || !animeSeriesType) {
    return { error: 'seriesType is invalid.' };
  }

  const activeAnimeProfileName = parseOptionalServiceString(
    settings.activeAnimeProfileName,
    'activeAnimeProfileName'
  );
  if ('error' in activeAnimeProfileName) return activeAnimeProfileName;

  const activeAnimeDirectory = parseOptionalServiceString(
    settings.activeAnimeDirectory,
    'activeAnimeDirectory',
    MAX_SERVICE_PATH_LENGTH
  );
  if ('error' in activeAnimeDirectory) return activeAnimeDirectory;

  const animeTags = parseNumberArray(settings.animeTags, 'animeTags');
  if ('error' in animeTags) return animeTags;

  const monitorNewItems =
    settings.monitorNewItems === 'all' || settings.monitorNewItems === 'none'
      ? settings.monitorNewItems
      : undefined;

  if (!monitorNewItems) {
    return { error: 'monitorNewItems is invalid.' };
  }

  return {
    value: {
      ...parsed.value,
      seriesType,
      animeSeriesType,
      activeAnimeProfileId: parseOptionalNonNegativeInteger(
        settings.activeAnimeProfileId,
        MAX_SERVICE_ID
      ),
      activeAnimeProfileName: activeAnimeProfileName.value,
      activeAnimeDirectory: activeAnimeDirectory.value,
      activeAnimeLanguageProfileId: parseOptionalNonNegativeInteger(
        settings.activeAnimeLanguageProfileId,
        MAX_SERVICE_ID
      ),
      activeLanguageProfileId: parseOptionalNonNegativeInteger(
        settings.activeLanguageProfileId,
        MAX_SERVICE_ID
      ),
      animeTags: animeTags.value,
      enableSeasonFolders:
        parseOptionalBoolean(settings.enableSeasonFolders) ?? false,
      monitorNewItems,
    },
  };
};

export const parseLidarrSettings = (
  body: unknown,
  current?: LidarrSettings
): { value: LidarrSettings } | { error: string } => {
  const parsed = parseDvrSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<LidarrSettings>;

  const activeMetadataProfileName = parseOptionalServiceString(
    settings.activeMetadataProfileName,
    'activeMetadataProfileName'
  );
  if ('error' in activeMetadataProfileName) return activeMetadataProfileName;

  return {
    value: {
      ...parsed.value,
      activeMetadataProfileId: parseOptionalNonNegativeInteger(
        settings.activeMetadataProfileId,
        MAX_SERVICE_ID
      ),
      activeMetadataProfileName: activeMetadataProfileName.value,
    },
  };
};

export const parseReadarrSettings = (
  body: unknown,
  current?: ReadarrSettings
): { value: ReadarrSettings } | { error: string } => {
  const parsed = parseLidarrSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<ReadarrSettings>;

  const serviceType =
    settings.serviceType === 'ebook' || settings.serviceType === 'audiobook'
      ? settings.serviceType
      : undefined;

  if (!serviceType) {
    return { error: 'serviceType is invalid.' };
  }

  return {
    value: {
      ...parsed.value,
      serviceType,
    },
  };
};
