import { parseOptionalNonNegativeInteger } from '@server/utils/validation';

const MAX_ROUTE_ID = 1_000_000_000;

export const parsePositiveRouteId = (
  id: unknown,
  maxValue = MAX_ROUTE_ID
): number | undefined => {
  const parsedValue =
    typeof id === 'string' && id.trim() !== '' ? Number(id) : id;
  const parsed = parseOptionalNonNegativeInteger(parsedValue, maxValue);

  return parsed && parsed > 0 ? parsed : undefined;
};
