import type {
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';

export const clampNumber = (value: number | undefined, fallback = 0): number =>
  Number.isFinite(value) ? (value as number) : fallback;

export const getRecencyScore = (date?: string): number => {
  const year = Number(date?.slice(0, 4));

  if (!Number.isFinite(year)) {
    return 0;
  }

  const currentYear = new Date().getUTCFullYear();

  return Math.max(0, 30 - Math.max(0, currentYear - year));
};

export const scoreTmdbResult = ({
  popularity,
  vote_average: voteAverage,
  vote_count: voteCount,
  date,
}: {
  popularity: number;
  vote_average: number;
  vote_count: number;
  date?: string;
}): number => {
  const popularityScore = Math.log10(clampNumber(popularity) + 1) * 24;
  const voteCountScore = Math.log10(clampNumber(voteCount) + 1) * 20;
  const voteAverageScore = clampNumber(voteAverage) * 8;
  const recencyScore = getRecencyScore(date) * 0.5;

  return popularityScore + voteCountScore + voteAverageScore + recencyScore;
};

export const rankTmdbMovieResults = (
  results: TmdbMovieResult[]
): TmdbMovieResult[] =>
  [...results].sort(
    (a, b) =>
      scoreTmdbResult({ ...b, date: b.release_date }) -
      scoreTmdbResult({ ...a, date: a.release_date })
  );

export const rankTmdbTvResults = (results: TmdbTvResult[]): TmdbTvResult[] =>
  [...results].sort(
    (a, b) =>
      scoreTmdbResult({ ...b, date: b.first_air_date }) -
      scoreTmdbResult({ ...a, date: a.first_air_date })
  );
