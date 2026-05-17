export const encodeApiPathSegment = (value: number | string): string =>
  encodeURIComponent(value.toString());
