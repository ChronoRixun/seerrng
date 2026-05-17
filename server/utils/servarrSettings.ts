import type {
  DVRSettings,
  LidarrSettings,
  RadarrSettings,
  ReadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import {
  parseBoundedString,
  parseOptionalBoolean,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';

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
    const parsed = parseOptionalNonNegativeInteger(
      Number(item),
      MAX_SERVICE_ID
    );

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

const parseDvrSettings = (
  body: Partial<DVRSettings>,
  current?: DVRSettings
): { value: DVRSettings } | { error: string } => {
  const name = parseRequiredServiceString(body.name, 'name');
  if ('error' in name) return name;

  const hostname = parseRequiredServiceString(body.hostname, 'hostname');
  if ('error' in hostname) return hostname;

  const apiKey = parseRequiredServiceString(body.apiKey, 'apiKey');
  if ('error' in apiKey) return apiKey;

  const activeProfileName = parseRequiredServiceString(
    body.activeProfileName,
    'activeProfileName'
  );
  if ('error' in activeProfileName) return activeProfileName;

  const activeDirectory = parseRequiredServiceString(
    body.activeDirectory,
    'activeDirectory',
    MAX_SERVICE_PATH_LENGTH
  );
  if ('error' in activeDirectory) return activeDirectory;

  const baseUrl = parseOptionalServiceString(body.baseUrl, 'baseUrl');
  if ('error' in baseUrl) return baseUrl;

  const externalUrl = parseOptionalServiceString(
    body.externalUrl,
    'externalUrl'
  );
  if ('error' in externalUrl) return externalUrl;

  const tags = parseNumberArray(body.tags, 'tags');
  if ('error' in tags) return tags;

  const overrideRule = parseNumberArray(body.overrideRule, 'overrideRule');
  if ('error' in overrideRule) return overrideRule;

  const port = parseOptionalNonNegativeInteger(body.port, MAX_SERVICE_PORT);
  const activeProfileId = parseOptionalNonNegativeInteger(
    body.activeProfileId,
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
      hostname: hostname.value,
      port,
      apiKey: apiKey.value,
      useSsl: parseOptionalBoolean(body.useSsl) ?? false,
      baseUrl: baseUrl.value,
      activeProfileId,
      activeProfileName: activeProfileName.value,
      activeDirectory: activeDirectory.value,
      tags: tags.value,
      is4k: parseOptionalBoolean(body.is4k) ?? false,
      isDefault: parseOptionalBoolean(body.isDefault) ?? false,
      externalUrl: externalUrl.value,
      syncEnabled: parseOptionalBoolean(body.syncEnabled) ?? false,
      preventSearch: parseOptionalBoolean(body.preventSearch) ?? false,
      tagRequests: parseOptionalBoolean(body.tagRequests) ?? false,
      overrideRule: overrideRule.value,
    },
  };
};

export const parseRadarrSettings = (
  body: Partial<RadarrSettings>,
  current?: RadarrSettings
): { value: RadarrSettings } | { error: string } => {
  const parsed = parseDvrSettings(body, current);
  if ('error' in parsed) return parsed;

  const minimumAvailability = parseRequiredServiceString(
    body.minimumAvailability,
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
  body: Partial<SonarrSettings>,
  current?: SonarrSettings
): { value: SonarrSettings } | { error: string } => {
  const parsed = parseDvrSettings(body, current);
  if ('error' in parsed) return parsed;

  const seriesTypes = ['standard', 'daily', 'anime'] as const;
  const seriesType =
    typeof body.seriesType === 'string' && seriesTypes.includes(body.seriesType)
      ? body.seriesType
      : undefined;
  const animeSeriesType =
    typeof body.animeSeriesType === 'string' &&
    seriesTypes.includes(body.animeSeriesType)
      ? body.animeSeriesType
      : undefined;

  if (!seriesType || !animeSeriesType) {
    return { error: 'seriesType is invalid.' };
  }

  const activeAnimeProfileName = parseOptionalServiceString(
    body.activeAnimeProfileName,
    'activeAnimeProfileName'
  );
  if ('error' in activeAnimeProfileName) return activeAnimeProfileName;

  const activeAnimeDirectory = parseOptionalServiceString(
    body.activeAnimeDirectory,
    'activeAnimeDirectory',
    MAX_SERVICE_PATH_LENGTH
  );
  if ('error' in activeAnimeDirectory) return activeAnimeDirectory;

  const animeTags = parseNumberArray(body.animeTags, 'animeTags');
  if ('error' in animeTags) return animeTags;

  const monitorNewItems =
    body.monitorNewItems === 'all' || body.monitorNewItems === 'none'
      ? body.monitorNewItems
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
        body.activeAnimeProfileId,
        MAX_SERVICE_ID
      ),
      activeAnimeProfileName: activeAnimeProfileName.value,
      activeAnimeDirectory: activeAnimeDirectory.value,
      activeAnimeLanguageProfileId: parseOptionalNonNegativeInteger(
        body.activeAnimeLanguageProfileId,
        MAX_SERVICE_ID
      ),
      activeLanguageProfileId: parseOptionalNonNegativeInteger(
        body.activeLanguageProfileId,
        MAX_SERVICE_ID
      ),
      animeTags: animeTags.value,
      enableSeasonFolders:
        parseOptionalBoolean(body.enableSeasonFolders) ?? false,
      monitorNewItems,
    },
  };
};

export const parseLidarrSettings = (
  body: Partial<LidarrSettings>,
  current?: LidarrSettings
): { value: LidarrSettings } | { error: string } => {
  const parsed = parseDvrSettings(body, current);
  if ('error' in parsed) return parsed;

  const activeMetadataProfileName = parseOptionalServiceString(
    body.activeMetadataProfileName,
    'activeMetadataProfileName'
  );
  if ('error' in activeMetadataProfileName) return activeMetadataProfileName;

  return {
    value: {
      ...parsed.value,
      activeMetadataProfileId: parseOptionalNonNegativeInteger(
        body.activeMetadataProfileId,
        MAX_SERVICE_ID
      ),
      activeMetadataProfileName: activeMetadataProfileName.value,
    },
  };
};

export const parseReadarrSettings = (
  body: Partial<ReadarrSettings>,
  current?: ReadarrSettings
): { value: ReadarrSettings } | { error: string } => {
  const parsed = parseLidarrSettings(body, current);
  if ('error' in parsed) return parsed;

  const serviceType =
    body.serviceType === 'ebook' || body.serviceType === 'audiobook'
      ? body.serviceType
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
