export const parsePositiveInt = (
  value: unknown,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER
): number => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
};

export const parseNonNegativeInt = (
  value: unknown,
  fallback = 0,
  max = Number.MAX_SAFE_INTEGER
): number => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
};

export const parseOptionalPositiveInt = (
  value: unknown,
  max = Number.MAX_SAFE_INTEGER
): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }

  return Math.min(Math.floor(parsed), max);
};

export const parsePageParams = (
  query: { take?: unknown; skip?: unknown },
  defaults: { take: number; maxTake?: number; maxSkip?: number }
) => {
  const pageSize = parsePositiveInt(
    query.take,
    defaults.take,
    defaults.maxTake ?? 100
  );
  const skip = parseNonNegativeInt(query.skip, 0, defaults.maxSkip);

  return { pageSize, skip };
};
