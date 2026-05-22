import { MediaType } from '@server/constants/media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import {
  normalizeExternalBookId,
  normalizeExternalMediaId,
  normalizeMusicBrainzId,
} from '@server/lib/externalIds';

const mediaTypes = new Set<string>(Object.values(MediaType));
const identifierProviders = new Set<string>(
  Object.values(MediaIdentifierProvider)
);

const normalizeResponseRecord = (
  record: Record<string, unknown>
): Record<string, unknown> => {
  const normalized = { ...record };
  const mediaType = normalized.mediaType;
  const provider = normalized.provider;
  const externalProvider = normalized.externalProvider;

  if (typeof normalized.mbId === 'string') {
    normalized.mbId = normalizeMusicBrainzId(normalized.mbId);
  }

  if (
    typeof normalized.externalId === 'string' &&
    typeof mediaType === 'string' &&
    mediaTypes.has(mediaType)
  ) {
    normalized.externalId = normalizeExternalMediaId(
      normalized.externalId,
      mediaType as MediaType,
      typeof externalProvider === 'string' &&
        identifierProviders.has(externalProvider)
        ? (externalProvider as MediaIdentifierProvider)
        : undefined
    );
  }

  if (
    typeof normalized.value === 'string' &&
    typeof provider === 'string' &&
    identifierProviders.has(provider)
  ) {
    normalized.value =
      provider === MediaIdentifierProvider.MUSICBRAINZ
        ? normalizeMusicBrainzId(normalized.value)
        : normalizeExternalBookId(
            normalized.value,
            provider as MediaIdentifierProvider
          );
  }

  return normalized;
};

export const filterEntityResponse = <T>(value: T): T => {
  const seen = new WeakSet<object>();

  const filter = (current: unknown): unknown => {
    if (current instanceof User) {
      return current.filter();
    }

    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object' ||
      current instanceof Date
    ) {
      return current;
    }

    if (seen.has(current)) {
      return undefined;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      return current.map(filter);
    }

    return Object.fromEntries(
      Object.entries(
        normalizeResponseRecord(current as Record<string, unknown>)
      )
        .map(([key, nestedValue]) => [key, filter(nestedValue)])
        .filter(([, nestedValue]) => nestedValue !== undefined)
    );
  };

  return filter(value) as T;
};
