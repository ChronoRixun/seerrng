import { User } from '@server/entity/User';

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
      Object.entries(current as Record<string, unknown>)
        .map(([key, nestedValue]) => [key, filter(nestedValue)])
        .filter(([, nestedValue]) => nestedValue !== undefined)
    );
  };

  return filter(value) as T;
};
