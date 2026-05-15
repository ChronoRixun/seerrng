const UPSTREAM_TMDB_API_KEY = '431a8708161bcd1f1fbe7536137e61ed';

export const getTmdbAuthParams = (): Record<string, string> => {
  if (process.env.TMDB_API_KEY) {
    return { api_key: process.env.TMDB_API_KEY };
  }

  return { api_key: UPSTREAM_TMDB_API_KEY };
};

export const getTmdbAuthHeaders = (): Record<string, string> => {
  if (process.env.TMDB_READ_ACCESS_TOKEN) {
    return { Authorization: `Bearer ${process.env.TMDB_READ_ACCESS_TOKEN}` };
  }

  return {};
};
