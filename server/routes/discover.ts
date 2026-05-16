import ListenBrainzAPI from '@server/api/listenbrainz';
import type {
  LbRelease,
  LbReleaseGroup,
} from '@server/api/listenbrainz/interfaces';
import MusicBrainz from '@server/api/musicbrainz';
import type { MbAlbumResult } from '@server/api/musicbrainz/interfaces';
import type { OpenLibrarySearchDoc } from '@server/api/openlibrary';
import OpenLibraryAPI from '@server/api/openlibrary';
import type { SortOptions } from '@server/api/themoviedb';
import TheMovieDb from '@server/api/themoviedb';
import type { TmdbKeyword } from '@server/api/themoviedb/interfaces';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type MediaEntity from '@server/entity/Media';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import type {
  GenreSliderItem,
  WatchlistResponse,
} from '@server/interfaces/api/discoverInterfaces';
import { getSettings } from '@server/lib/settings';
import { getCombinedWatchlist } from '@server/lib/watchlist';
import logger from '@server/logger';
import { mapOpenLibrarySearchDoc } from '@server/models/Book';
import { mapProductionCompany } from '@server/models/Movie';
import {
  mapAlbumResult,
  mapCollectionResult,
  mapMovieResult,
  mapPersonResult,
  mapTvResult,
} from '@server/models/Search';
import { mapNetwork } from '@server/models/Tv';
import { isCollection, isMovie, isPerson } from '@server/utils/typeHelpers';
import { Router } from 'express';
import { sortBy } from 'lodash';
import { In } from 'typeorm';
import { z } from 'zod';

export const createTmdbWithRegionLanguage = (user?: User): TheMovieDb => {
  const settings = getSettings();

  const discoverRegion =
    user?.settings?.streamingRegion === 'all'
      ? ''
      : user?.settings?.streamingRegion
        ? user?.settings?.streamingRegion
        : settings.main.discoverRegion;

  const originalLanguage =
    user?.settings?.originalLanguage === 'all'
      ? ''
      : user?.settings?.originalLanguage
        ? user?.settings?.originalLanguage
        : settings.main.originalLanguage;

  return new TheMovieDb({
    discoverRegion,
    originalLanguage,
  });
};

export const createTmdbWithBlocklistSettings = (): TheMovieDb => {
  const settings = getSettings();

  return new TheMovieDb({
    discoverRegion: settings.main.blocklistRegion,
    originalLanguage: settings.main.blocklistLanguage,
  });
};

const discoverRoutes = Router();

const emptyDiscoverResponse = (page: number) => ({
  page,
  totalPages: 1,
  totalResults: 0,
  results: [],
});

const getUnknownTotalResults = (
  page: number,
  resultCount: number,
  itemsPerPage: number
) =>
  resultCount === itemsPerPage
    ? page * itemsPerPage + itemsPerPage + 1
    : (page - 1) * itemsPerPage + resultCount;

const getProviderWindow = (
  page: number,
  itemsPerPage: number,
  windowSize = 100
) => {
  const pageOffset = (page - 1) * itemsPerPage;
  const windowOffset = Math.floor(pageOffset / windowSize) * windowSize;

  return {
    offset: windowOffset,
    limit: windowSize,
    sliceStart: pageOffset - windowOffset,
    sliceEnd: pageOffset - windowOffset + itemsPerPage,
  };
};

const clampNumber = (value: number | undefined, fallback = 0): number =>
  Number.isFinite(value) ? (value as number) : fallback;

const getRecencyScore = (date?: string): number => {
  const year = Number(date?.slice(0, 4));

  if (!Number.isFinite(year)) {
    return 0;
  }

  const currentYear = new Date().getUTCFullYear();

  return Math.max(0, 30 - Math.max(0, currentYear - year));
};

const scoreMusicRelease = (release: LbRelease): number => {
  const listenScore = Math.log10((release.listen_count ?? 0) + 1) * 40;
  const recencyScore = getRecencyScore(release.release_date);
  const coverScore = release.caa_release_mbid ? 8 : 0;
  const typeScore =
    release.release_group_primary_type === 'Album'
      ? 8
      : release.release_group_primary_type === 'EP'
        ? 4
        : 0;

  return listenScore + recencyScore + coverScore + typeScore;
};

const scoreMusicAlbum = (album: MbAlbumResult): number => {
  const searchScore = clampNumber(album.score) * 2;
  const recencyScore = getRecencyScore(album['first-release-date']);
  const coverScore = album.posterPath ? 8 : 0;
  const typeScore =
    album['primary-type'] === 'Album'
      ? 8
      : album['primary-type'] === 'EP'
        ? 4
        : 0;

  return searchScore + recencyScore + coverScore + typeScore;
};

const scoreBookDoc = (doc: OpenLibrarySearchDoc): number => {
  const ratingScore = clampNumber(doc.ratings_average) * 12;
  const ratingCountScore = Math.log10(clampNumber(doc.ratings_count) + 1) * 18;
  const wantToReadScore =
    Math.log10(clampNumber(doc.want_to_read_count) + 1) * 12;
  const editionScore = Math.log10(clampNumber(doc.edition_count) + 1) * 10;
  const recencyScore =
    getRecencyScore(doc.first_publish_year?.toString()) * 0.5;
  const metadataScore =
    (doc.cover_i ? 8 : 0) + (doc.author_name?.length ? 4 : 0);

  return (
    ratingScore +
    ratingCountScore +
    wantToReadScore +
    editionScore +
    recencyScore +
    metadataScore
  );
};

const getBookAuthorDiversityKey = (doc: OpenLibrarySearchDoc): string =>
  doc.author_key?.[0] ?? doc.author_name?.[0] ?? doc.key;

const diversifyBookDocsByAuthor = (
  docs: OpenLibrarySearchDoc[],
  limit: number,
  maxPerAuthor = 2
): OpenLibrarySearchDoc[] => {
  const selectedDocs: OpenLibrarySearchDoc[] = [];
  const skippedDocs: OpenLibrarySearchDoc[] = [];
  const authorCounts = new Map<string, number>();

  docs.forEach((doc) => {
    const authorKey = getBookAuthorDiversityKey(doc);
    const authorCount = authorCounts.get(authorKey) ?? 0;

    if (authorCount < maxPerAuthor) {
      selectedDocs.push(doc);
      authorCounts.set(authorKey, authorCount + 1);
    } else {
      skippedDocs.push(doc);
    }
  });

  return [...selectedDocs, ...skippedDocs].slice(0, limit);
};

const mapTopAlbumRelease = (releaseGroup: LbReleaseGroup): MbAlbumResult => ({
  id: releaseGroup.release_group_mbid,
  score: releaseGroup.listen_count ?? 0,
  media_type: 'album',
  title: releaseGroup.release_group_name,
  'primary-type': 'Album' as const,
  'first-release-date': '',
  'artist-credit': [
    {
      name: releaseGroup.artist_name,
      artist: {
        id: releaseGroup.artist_mbids[0],
        name: releaseGroup.artist_name,
        'sort-name': releaseGroup.artist_name,
      },
    },
  ],
  posterPath: releaseGroup.caa_release_mbid
    ? `https://coverartarchive.org/release/${releaseGroup.caa_release_mbid}/front-250`
    : undefined,
});

const mapFreshReleaseAlbum = (release: LbRelease): MbAlbumResult => ({
  id: release.release_group_mbid,
  score: scoreMusicRelease(release),
  media_type: 'album',
  title: release.release_name,
  'primary-type':
    release.release_group_primary_type === 'Single' ||
    release.release_group_primary_type === 'EP'
      ? release.release_group_primary_type
      : 'Album',
  'first-release-date': release.release_date,
  'artist-credit': [
    {
      name: release.artist_credit_name,
      artist: {
        id: release.artist_mbids[0],
        name: release.artist_credit_name,
        'sort-name': release.artist_credit_name,
      },
    },
  ],
  posterPath: release.caa_release_mbid
    ? `https://coverartarchive.org/release/${release.caa_release_mbid}/front-250`
    : undefined,
});

const mergeMusicAlbumMetadata = (
  existingAlbum: MbAlbumResult,
  incomingAlbum: MbAlbumResult
): MbAlbumResult => {
  const primaryAlbum =
    scoreMusicAlbum(incomingAlbum) > scoreMusicAlbum(existingAlbum)
      ? incomingAlbum
      : existingAlbum;
  const fallbackAlbum =
    primaryAlbum === incomingAlbum ? existingAlbum : incomingAlbum;

  return {
    ...primaryAlbum,
    score: Math.max(
      clampNumber(existingAlbum.score),
      clampNumber(incomingAlbum.score)
    ),
    title: primaryAlbum.title || fallbackAlbum.title,
    'first-release-date':
      primaryAlbum['first-release-date'] || fallbackAlbum['first-release-date'],
    'artist-credit': primaryAlbum['artist-credit'].length
      ? primaryAlbum['artist-credit']
      : fallbackAlbum['artist-credit'],
    posterPath: primaryAlbum.posterPath ?? fallbackAlbum.posterPath,
  };
};

const getMusicArtistDiversityKey = (album: MbAlbumResult): string =>
  album['artist-credit'][0]?.artist?.id ??
  album['artist-credit'][0]?.name ??
  album.id;

const diversifyMusicAlbumsByArtist = (
  albums: MbAlbumResult[],
  limit: number,
  maxPerArtist = 2
): MbAlbumResult[] => {
  const selectedAlbums: MbAlbumResult[] = [];
  const skippedAlbums: MbAlbumResult[] = [];
  const artistCounts = new Map<string, number>();

  albums.forEach((album) => {
    const artistKey = getMusicArtistDiversityKey(album);
    const artistCount = artistCounts.get(artistKey) ?? 0;

    if (artistCount < maxPerArtist) {
      selectedAlbums.push(album);
      artistCounts.set(artistKey, artistCount + 1);
    } else {
      skippedAlbums.push(album);
    }
  });

  return [...selectedAlbums, ...skippedAlbums].slice(0, limit);
};

const defaultBookDiscoverySubjects = [
  'fiction',
  'fantasy',
  'science_fiction',
  'mystery',
  'biography',
  'romance',
  'history',
  'thriller',
  'literary_fiction',
  'historical_fiction',
  'horror',
  'young_adult',
  'memoir',
  'science',
  'philosophy',
  'poetry',
];

const getDailyRotationOffset = (itemCount: number): number => {
  if (itemCount <= 0) {
    return 0;
  }

  return Math.floor(Date.now() / 86_400_000) % itemCount;
};

const rotateItems = <T>(items: T[], offset: number): T[] => [
  ...items.slice(offset),
  ...items.slice(0, offset),
];

const musicSortOptions = new Set([
  'ranked',
  'popular.week',
  'popular.month',
  'popular.year',
  'listen_count.desc',
  'release_date.desc',
  'release_date.asc',
]);

const bookSortOptions = new Set([
  'ranked',
  'newest',
  'oldest',
  'random',
  'rating',
  'editions',
]);

const getValidatedSort = (
  sortBy: unknown,
  allowedSortOptions: Set<string>
): string =>
  typeof sortBy === 'string' && allowedSortOptions.has(sortBy)
    ? sortBy
    : 'ranked';

const QueryFilterOptions = z.object({
  page: z.coerce.string().optional(),
  sortBy: z.coerce.string().optional(),
  primaryReleaseDateGte: z.coerce.string().optional(),
  primaryReleaseDateLte: z.coerce.string().optional(),
  firstAirDateGte: z.coerce.string().optional(),
  firstAirDateLte: z.coerce.string().optional(),
  studio: z.coerce.string().optional(),
  genre: z.coerce.string().optional(),
  keywords: z.coerce.string().optional(),
  excludeKeywords: z.coerce.string().optional(),
  language: z.coerce.string().optional(),
  withRuntimeGte: z.coerce.string().optional(),
  withRuntimeLte: z.coerce.string().optional(),
  voteAverageGte: z.coerce.string().optional(),
  voteAverageLte: z.coerce.string().optional(),
  voteCountGte: z.coerce.string().optional(),
  voteCountLte: z.coerce.string().optional(),
  network: z.coerce.string().optional(),
  watchProviders: z.coerce.string().optional(),
  watchRegion: z.coerce.string().optional(),
  status: z.coerce.string().optional(),
  certification: z.coerce.string().optional(),
  certificationGte: z.coerce.string().optional(),
  certificationLte: z.coerce.string().optional(),
  certificationCountry: z.coerce.string().optional(),
  certificationMode: z.enum(['exact', 'range']).optional(),
});

export type FilterOptions = z.infer<typeof QueryFilterOptions>;
const ApiQuerySchema = QueryFilterOptions.omit({
  certificationMode: true,
});

discoverRoutes.get('/movies', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const query = ApiQuerySchema.parse(req.query);
    const keywords = query.keywords;
    const excludeKeywords = query.excludeKeywords;

    const data = await tmdb.getDiscoverMovies({
      page: Number(query.page),
      sortBy: query.sortBy as SortOptions,
      language: req.locale ?? query.language,
      originalLanguage: query.language,
      genre: query.genre,
      studio: query.studio,
      primaryReleaseDateLte: query.primaryReleaseDateLte
        ? new Date(query.primaryReleaseDateLte).toISOString().split('T')[0]
        : undefined,
      primaryReleaseDateGte: query.primaryReleaseDateGte
        ? new Date(query.primaryReleaseDateGte).toISOString().split('T')[0]
        : undefined,
      keywords,
      excludeKeywords,
      withRuntimeGte: query.withRuntimeGte,
      withRuntimeLte: query.withRuntimeLte,
      voteAverageGte: query.voteAverageGte,
      voteAverageLte: query.voteAverageLte,
      voteCountGte: query.voteCountGte,
      voteCountLte: query.voteCountLte,
      watchProviders: query.watchProviders,
      watchRegion: query.watchRegion,
      certification: query.certification,
      certificationGte: query.certificationGte,
      certificationLte: query.certificationLte,
      certificationCountry: query.certificationCountry,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    let keywordData: TmdbKeyword[] = [];
    if (keywords) {
      const splitKeywords = keywords.split(',');

      const keywordResults = await Promise.all(
        splitKeywords.map(async (keywordId) => {
          return await tmdb.getKeywordDetails({ keywordId: Number(keywordId) });
        })
      );

      keywordData = keywordResults.filter(
        (keyword): keyword is TmdbKeyword => keyword !== null
      );
    }

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      keywords: keywordData,
      results: data.results.map((result) =>
        mapMovieResult(
          result,
          media.find(
            (req) =>
              req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving popular movies', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve popular movies.',
    });
  }
});

discoverRoutes.get<{ language: string }>(
  '/movies/language/:language',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const languages = await tmdb.getLanguages();

      const language = languages.find(
        (lang) => lang.iso_639_1 === req.params.language
      );

      if (!language) {
        return next({ status: 404, message: 'Language not found.' });
      }

      const data = await tmdb.getDiscoverMovies({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        originalLanguage: req.params.language,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        language,
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (req) =>
                req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by language', {
        label: 'API',
        errorMessage: e.message,
        language: req.params.language,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by language.',
      });
    }
  }
);

discoverRoutes.get<{ genreId: string }>(
  '/movies/genre/:genreId',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const genres = await tmdb.getMovieGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      const genre = genres.find(
        (genre) => genre.id === Number(req.params.genreId)
      );

      if (!genre) {
        return next({ status: 404, message: 'Genre not found.' });
      }

      const data = await tmdb.getDiscoverMovies({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        genre: req.params.genreId as string,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        genre,
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (req) =>
                req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by genre', {
        label: 'API',
        errorMessage: e.message,
        genreId: req.params.genreId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by genre.',
      });
    }
  }
);

discoverRoutes.get<{ studioId: string }>(
  '/movies/studio/:studioId',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const studio = await tmdb.getStudio(Number(req.params.studioId));

      const data = await tmdb.getDiscoverMovies({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        studio: req.params.studioId as string,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        studio: mapProductionCompany(studio),
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by studio', {
        label: 'API',
        errorMessage: e.message,
        studioId: req.params.studioId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by studio.',
      });
    }
  }
);

discoverRoutes.get('/movies/upcoming', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const date = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const data = await tmdb.getDiscoverMovies({
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
      primaryReleaseDateGte: date,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) =>
        mapMovieResult(
          result,
          media.find(
            (med) =>
              med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving upcoming movies', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve upcoming movies.',
    });
  }
});

discoverRoutes.get('/tv', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const query = ApiQuerySchema.parse(req.query);
    const keywords = query.keywords;
    const excludeKeywords = query.excludeKeywords;
    const data = await tmdb.getDiscoverTv({
      page: Number(query.page),
      sortBy: query.sortBy as SortOptions,
      language: req.locale ?? query.language,
      genre: query.genre,
      network: query.network ? Number(query.network) : undefined,
      firstAirDateLte: query.firstAirDateLte
        ? new Date(query.firstAirDateLte).toISOString().split('T')[0]
        : undefined,
      firstAirDateGte: query.firstAirDateGte
        ? new Date(query.firstAirDateGte).toISOString().split('T')[0]
        : undefined,
      originalLanguage: query.language,
      keywords,
      excludeKeywords,
      withRuntimeGte: query.withRuntimeGte,
      withRuntimeLte: query.withRuntimeLte,
      voteAverageGte: query.voteAverageGte,
      voteAverageLte: query.voteAverageLte,
      voteCountGte: query.voteCountGte,
      voteCountLte: query.voteCountLte,
      watchProviders: query.watchProviders,
      watchRegion: query.watchRegion,
      withStatus: query.status,
      certification: query.certification,
      certificationGte: query.certificationGte,
      certificationLte: query.certificationLte,
      certificationCountry: query.certificationCountry,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    let keywordData: TmdbKeyword[] = [];
    if (keywords) {
      const splitKeywords = keywords.split(',');

      const keywordResults = await Promise.all(
        splitKeywords.map(async (keywordId) => {
          return await tmdb.getKeywordDetails({ keywordId: Number(keywordId) });
        })
      );

      keywordData = keywordResults.filter(
        (keyword): keyword is TmdbKeyword => keyword !== null
      );
    }

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      keywords: keywordData,
      results: data.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (med) => med.tmdbId === result.id && med.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving popular series', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve popular series.',
    });
  }
});

discoverRoutes.get<{ language: string }>(
  '/tv/language/:language',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const languages = await tmdb.getLanguages();

      const language = languages.find(
        (lang) => lang.iso_639_1 === req.params.language
      );

      if (!language) {
        return next({ status: 404, message: 'Language not found.' });
      }

      const data = await tmdb.getDiscoverTv({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        originalLanguage: req.params.language,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        language,
        results: data.results.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by language', {
        label: 'API',
        errorMessage: e.message,
        language: req.params.language,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by language.',
      });
    }
  }
);

discoverRoutes.get<{ genreId: string }>(
  '/tv/genre/:genreId',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const genres = await tmdb.getTvGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      const genre = genres.find(
        (genre) => genre.id === Number(req.params.genreId)
      );

      if (!genre) {
        return next({ status: 404, message: 'Genre not found.' });
      }

      const data = await tmdb.getDiscoverTv({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        genre: req.params.genreId,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        genre,
        results: data.results.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by genre', {
        label: 'API',
        errorMessage: e.message,
        genreId: req.params.genreId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by genre.',
      });
    }
  }
);

discoverRoutes.get<{ networkId: string }>(
  '/tv/network/:networkId',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const network = await tmdb.getNetwork(Number(req.params.networkId));

      const data = await tmdb.getDiscoverTv({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        network: Number(req.params.networkId),
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        network: mapNetwork(network),
        results: data.results.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by network', {
        label: 'API',
        errorMessage: e.message,
        networkId: req.params.networkId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by network.',
      });
    }
  }
);

discoverRoutes.get('/tv/upcoming', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const date = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const data = await tmdb.getDiscoverTv({
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
      firstAirDateGte: date,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (med) => med.tmdbId === result.id && med.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving upcoming series', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve upcoming series.',
    });
  }
});

discoverRoutes.get('/trending', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const mediaType = (req.query.mediaType as 'all' | 'movie' | 'tv') ?? 'all';
    const timeWindow =
      (req.query.timeWindow as 'day' | 'week') === 'week' ? 'week' : 'day';
    const language = (req.query.language as string) ?? req.locale;
    const page = Number(req.query.page);

    const trendingFetchers = {
      movie: async () => ({
        data: await tmdb.getMovieTrending({ page, language, timeWindow }),
        mapper: mapMovieResult,
        type: MediaType.MOVIE,
      }),
      tv: async () => ({
        data: await tmdb.getTvTrending({ page, language, timeWindow }),
        mapper: mapTvResult,
        type: MediaType.TV,
      }),
      all: async () => ({
        data: await tmdb.getAllTrending({ page, language, timeWindow }),
        mapper: (result: any, media?: Media) => {
          if (isMovie(result)) {
            return mapMovieResult(result, media);
          } else if (isPerson(result)) {
            return mapPersonResult(result);
          } else if (isCollection(result)) {
            return mapCollectionResult(result);
          } else {
            return mapTvResult(result, media);
          }
        },
        type: null,
      }),
    } as const;

    const { data, mapper, type } = await trendingFetchers[mediaType]();

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: isMovie(result) ? MediaType.MOVIE : MediaType.TV,
      }))
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) => {
        // - If "type" is set (case: "movie" or "tv"), the mediaType must also match.
        // - If "type" is not set (case: "all"), only filter by tmdbId.
        const selectedMedia = media.find(
          (med) =>
            med.tmdbId === result.id && (type ? med.mediaType === type : true)
        );

        return mapper(result, selectedMedia);
      }),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving trending items', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve trending items.',
    });
  }
});

discoverRoutes.get<{ keywordId: string }>(
  '/keyword/:keywordId/movies',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const data = await tmdb.getMoviesByKeyword({
        keywordId: Number(req.params.keywordId),
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by keyword', {
        label: 'API',
        errorMessage: e.message,
        keywordId: req.params.keywordId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by keyword.',
      });
    }
  }
);

discoverRoutes.get<{ language: string }, GenreSliderItem[]>(
  '/genreslider/movie',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const mappedGenres: GenreSliderItem[] = [];

      const genres = await tmdb.getMovieGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      await Promise.all(
        genres.map(async (genre) => {
          const genreData = await tmdb.getDiscoverMovies({
            genre: genre.id.toString(),
          });

          mappedGenres.push({
            id: genre.id,
            name: genre.name,
            backdrops: genreData.results
              .filter((title) => !!title.backdrop_path)
              .map((title) => title.backdrop_path) as string[],
          });
        })
      );

      const sortedData = sortBy(mappedGenres, 'name');

      return res.status(200).json(sortedData);
    } catch (e) {
      logger.debug('Something went wrong retrieving the movie genre slider', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movie genre slider.',
      });
    }
  }
);

discoverRoutes.get<{ language: string }, GenreSliderItem[]>(
  '/genreslider/tv',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const mappedGenres: GenreSliderItem[] = [];

      const genres = await tmdb.getTvGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      await Promise.all(
        genres.map(async (genre) => {
          const genreData = await tmdb.getDiscoverTv({
            genre: genre.id.toString(),
          });

          mappedGenres.push({
            id: genre.id,
            name: genre.name,
            backdrops: genreData.results
              .filter((title) => !!title.backdrop_path)
              .map((title) => title.backdrop_path) as string[],
          });
        })
      );

      const sortedData = sortBy(mappedGenres, 'name');

      return res.status(200).json(sortedData);
    } catch (e) {
      logger.debug('Something went wrong retrieving the series genre slider', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series genre slider.',
      });
    }
  }
);

discoverRoutes.get('/music', async (req, res) => {
  const listenBrainz = new ListenBrainzAPI();
  const musicBrainz = new MusicBrainz();
  const itemsPerPage = 20;
  const page = req.query.page ? Number(req.query.page) : 1;
  const days = req.query.days ? Number(req.query.days) : 14;
  const hasCustomDays = typeof req.query.days === 'string';
  const sortByValue = getValidatedSort(req.query.sortBy, musicSortOptions);
  const sortAscending = sortByValue === 'release_date.asc';
  const genreFilter =
    typeof req.query.genre === 'string' && req.query.genre.trim()
      ? req.query.genre
          .split(',')
          .map((genre) => genre.trim())
          .filter(Boolean)
      : [];
  const releaseTypeFilter =
    typeof req.query.releaseType === 'string' && req.query.releaseType.trim()
      ? req.query.releaseType
          .split(',')
          .map((type) => type.trim())
          .filter(Boolean)
      : [];
  const query =
    typeof req.query.query === 'string' && req.query.query.trim()
      ? req.query.query.trim()
      : '';

  try {
    if (query) {
      const providerWindow = getProviderWindow(page, itemsPerPage);
      const albumWindow = await musicBrainz.searchAlbum({
        query,
        limit: providerWindow.limit,
        offset: providerWindow.offset,
      });
      const albums = albumWindow.slice(
        providerWindow.sliceStart,
        providerWindow.sliceEnd
      );
      const mbIds = albums.map((album) => album.id);
      const relatedMedia = mbIds.length
        ? await getRepository(Media).find({
            where: { mbId: In(mbIds), mediaType: MediaType.MUSIC },
            relations: { requests: true, watchlists: true },
          })
        : [];
      relatedMedia.forEach((media) => {
        media.watchlists =
          media.watchlists?.filter(
            (watchlist) => watchlist.requestedBy.id === req.user?.id
          ) ?? [];
      });

      return res.status(200).json({
        page,
        totalPages: albums.length === itemsPerPage ? page + 1 : page,
        totalResults: getUnknownTotalResults(page, albums.length, itemsPerPage),
        results: albums.map((album) =>
          mapAlbumResult(
            album,
            relatedMedia.find((media) => media.mbId === album.id)
          )
        ),
      });
    }

    if (genreFilter.length) {
      const providerWindow = getProviderWindow(page, itemsPerPage);
      const releaseDateGte = req.query.primaryReleaseDateGte
        ? String(req.query.primaryReleaseDateGte)
        : undefined;
      const releaseDateLte = req.query.primaryReleaseDateLte
        ? String(req.query.primaryReleaseDateLte)
        : undefined;
      const { releaseGroups, totalCount } =
        await musicBrainz.searchReleaseGroupsByTag({
          tags: genreFilter,
          primaryTypes: releaseTypeFilter.length
            ? releaseTypeFilter
            : undefined,
          releaseDateGte,
          releaseDateLte,
          limit: providerWindow.limit,
          offset: providerWindow.offset,
        });
      const sortedAlbums = releaseGroups.sort((a, b) => {
        if (sortByValue === 'ranked') {
          return scoreMusicAlbum(b) - scoreMusicAlbum(a);
        }

        if (sortByValue === 'listen_count.desc') {
          return (b.score ?? 0) - (a.score ?? 0);
        }

        const left = a['first-release-date'] ?? '';
        const right = b['first-release-date'] ?? '';
        return sortAscending
          ? left.localeCompare(right)
          : right.localeCompare(left);
      });
      const albums = sortedAlbums.slice(
        providerWindow.sliceStart,
        providerWindow.sliceEnd
      );
      const mbIds = albums.map((album) => album.id);
      const relatedMedia = mbIds.length
        ? await getRepository(Media).find({
            where: { mbId: In(mbIds), mediaType: MediaType.MUSIC },
            relations: { requests: true, watchlists: true },
          })
        : [];
      relatedMedia.forEach((media) => {
        media.watchlists =
          media.watchlists?.filter(
            (watchlist) => watchlist.requestedBy.id === req.user?.id
          ) ?? [];
      });

      return res.status(200).json({
        page,
        totalPages: Math.max(1, Math.ceil(totalCount / itemsPerPage)),
        totalResults: totalCount,
        results: albums.map((album) =>
          mapAlbumResult(
            album,
            relatedMedia.find((media) => media.mbId === album.id)
          )
        ),
      });
    }

    const providerWindow = getProviderWindow(page, itemsPerPage);
    const hasReleaseDateFilter =
      typeof req.query.primaryReleaseDateGte === 'string' ||
      typeof req.query.primaryReleaseDateLte === 'string';

    if (!genreFilter.length && sortByValue.startsWith('popular')) {
      const range =
        sortByValue === 'popular.week'
          ? 'week'
          : sortByValue === 'popular.year'
            ? 'year'
            : 'month';
      const topAlbums = await listenBrainz.getTopAlbums({
        range,
        offset: providerWindow.offset,
        count: providerWindow.limit,
      });
      const albums = diversifyMusicAlbumsByArtist(
        topAlbums.payload.release_groups.map(mapTopAlbumRelease),
        providerWindow.sliceEnd
      ).slice(providerWindow.sliceStart, providerWindow.sliceEnd);
      const mbIds = albums.map((album) => album.id);
      const relatedMedia = mbIds.length
        ? await getRepository(Media).find({
            where: { mbId: In(mbIds), mediaType: MediaType.MUSIC },
            relations: { requests: true, watchlists: true },
          })
        : [];
      relatedMedia.forEach((media) => {
        media.watchlists =
          media.watchlists?.filter(
            (watchlist) => watchlist.requestedBy.id === req.user?.id
          ) ?? [];
      });

      return res.status(200).json({
        page,
        totalPages: Math.max(
          1,
          Math.ceil(topAlbums.payload.count / itemsPerPage)
        ),
        totalResults: topAlbums.payload.count,
        results: albums.map((album) =>
          mapAlbumResult(
            album,
            relatedMedia.find((media) => media.mbId === album.id)
          )
        ),
      });
    }

    if (
      sortByValue === 'ranked' &&
      !releaseTypeFilter.length &&
      !hasReleaseDateFilter &&
      !hasCustomDays
    ) {
      const [topAlbumsResult, freshReleasesResult] = await Promise.allSettled([
        listenBrainz.getTopAlbums({
          range: 'week',
          offset: providerWindow.offset,
          count: providerWindow.limit,
        }),
        listenBrainz.getFreshReleases({
          days,
          sort: 'release_date',
          offset: providerWindow.offset,
          count: providerWindow.limit,
        }),
      ]);
      const topAlbums =
        topAlbumsResult.status === 'fulfilled'
          ? topAlbumsResult.value.payload.release_groups
          : [];
      const freshReleases =
        freshReleasesResult.status === 'fulfilled'
          ? freshReleasesResult.value.payload.releases
          : [];

      if (!topAlbums.length && !freshReleases.length) {
        throw new Error('No ranked music discovery sources were available');
      }

      if (topAlbumsResult.status === 'rejected') {
        logger.warn('Music chart discovery failed during ranked blend', {
          label: 'Discover Music',
          errorMessage:
            topAlbumsResult.reason instanceof Error
              ? topAlbumsResult.reason.message
              : 'Unknown error',
        });
      }

      if (freshReleasesResult.status === 'rejected') {
        logger.warn('Fresh music discovery failed during ranked blend', {
          label: 'Discover Music',
          errorMessage:
            freshReleasesResult.reason instanceof Error
              ? freshReleasesResult.reason.message
              : 'Unknown error',
        });
      }

      const albumsById = new Map<string, MbAlbumResult>();

      [
        ...topAlbums.map(mapTopAlbumRelease),
        ...freshReleases
          .filter(
            (release) => release.release_group_mbid && release.release_name
          )
          .map(mapFreshReleaseAlbum),
      ].forEach((album) => {
        const existingAlbum = albumsById.get(album.id);

        albumsById.set(
          album.id,
          existingAlbum ? mergeMusicAlbumMetadata(existingAlbum, album) : album
        );
      });

      const albums = diversifyMusicAlbumsByArtist(
        [...albumsById.values()].sort(
          (a, b) => scoreMusicAlbum(b) - scoreMusicAlbum(a)
        ),
        providerWindow.sliceEnd
      ).slice(providerWindow.sliceStart, providerWindow.sliceEnd);
      const mbIds = albums.map((album) => album.id);
      const relatedMedia = mbIds.length
        ? await getRepository(Media).find({
            where: { mbId: In(mbIds), mediaType: MediaType.MUSIC },
            relations: { requests: true, watchlists: true },
          })
        : [];
      relatedMedia.forEach((media) => {
        media.watchlists =
          media.watchlists?.filter(
            (watchlist) => watchlist.requestedBy.id === req.user?.id
          ) ?? [];
      });

      return res.status(200).json({
        page,
        totalPages: albums.length === itemsPerPage ? page + 1 : 1,
        totalResults: getUnknownTotalResults(page, albums.length, itemsPerPage),
        results: albums.map((album) =>
          mapAlbumResult(
            album,
            relatedMedia.find((media) => media.mbId === album.id)
          )
        ),
      });
    }

    let freshReleases;
    try {
      freshReleases = await listenBrainz.getFreshReleases({
        days,
        sort: 'release_date',
        offset: providerWindow.offset,
        count: providerWindow.limit,
      });
    } catch (e) {
      if (days <= 7) {
        throw e;
      }

      logger.warn('Music discovery failed, retrying with a shorter window', {
        label: 'Discover Music',
        days,
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      freshReleases = await listenBrainz.getFreshReleases({
        days: 7,
        sort: 'release_date',
        offset: providerWindow.offset,
        count: providerWindow.limit,
      });
    }
    const releases = freshReleases.payload.releases
      .filter((release) => release.release_group_mbid && release.release_name)
      .filter(
        (release) =>
          !releaseTypeFilter.length ||
          releaseTypeFilter.includes(
            release.release_group_primary_type ?? 'Album'
          )
      )
      .sort((a, b) => {
        if (sortByValue === 'ranked') {
          return scoreMusicRelease(b) - scoreMusicRelease(a);
        }

        if (sortByValue === 'listen_count.desc') {
          return (b.listen_count ?? 0) - (a.listen_count ?? 0);
        }

        const left = a.release_date ?? '';
        const right = b.release_date ?? '';
        return sortAscending
          ? left.localeCompare(right)
          : right.localeCompare(left);
      })
      .slice(providerWindow.sliceStart, providerWindow.sliceEnd);
    const mbIds = releases.map((release) => release.release_group_mbid);
    const relatedMedia = mbIds.length
      ? await getRepository(Media).find({
          where: { mbId: In(mbIds), mediaType: MediaType.MUSIC },
          relations: { requests: true, watchlists: true },
        })
      : [];
    relatedMedia.forEach((media) => {
      media.watchlists =
        media.watchlists?.filter(
          (watchlist) => watchlist.requestedBy.id === req.user?.id
        ) ?? [];
    });

    const results = releases.map((release) =>
      mapAlbumResult(
        {
          ...mapFreshReleaseAlbum(release),
          score:
            sortByValue === 'ranked'
              ? scoreMusicRelease(release)
              : (release.listen_count ?? 0),
        },
        relatedMedia.find((media) => media.mbId === release.release_group_mbid)
      )
    );

    return res.status(200).json({
      page,
      totalPages: releases.length === itemsPerPage ? page + 1 : page,
      totalResults: getUnknownTotalResults(page, releases.length, itemsPerPage),
      results,
    });
  } catch (e) {
    logger.error('Failed to fetch music discovery results', {
      label: 'Discover Music',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return res.status(200).json(emptyDiscoverResponse(page));
  }
});

discoverRoutes.get('/books', async (req, res) => {
  const openLibrary = new OpenLibraryAPI();
  const itemsPerPage = 20;
  const page = req.query.page ? Number(req.query.page) : 1;
  const sortByValue = getValidatedSort(req.query.sortBy, bookSortOptions);
  const subjectQuery =
    typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
  const hasSubjectFilter = !!subjectQuery;
  const subject = hasSubjectFilter ? subjectQuery : 'fiction';
  const searchQuery =
    typeof req.query.query === 'string' ? req.query.query.trim() : '';
  const hasSearchQuery = !!searchQuery;
  const query = hasSearchQuery ? searchQuery : `subject:${subject}`;

  try {
    const openLibrarySort =
      sortByValue === 'newest'
        ? 'new'
        : sortByValue === 'oldest'
          ? 'old'
          : sortByValue === 'random'
            ? 'random'
            : sortByValue === 'rating'
              ? 'rating'
              : sortByValue === 'editions'
                ? 'editions'
                : undefined;
    const shouldBlendDefaultSubjects =
      !hasSearchQuery && !hasSubjectFilter && sortByValue === 'ranked';
    const books = shouldBlendDefaultSubjects
      ? await Promise.allSettled(
          rotateItems(
            defaultBookDiscoverySubjects,
            getDailyRotationOffset(defaultBookDiscoverySubjects.length)
          )
            .slice(0, 8)
            .map((defaultSubject) =>
              openLibrary.searchBooks({
                query: `subject:${defaultSubject}`,
                page,
                limit: Math.ceil(itemsPerPage / 2),
              })
            )
        ).then((results) => {
          const responses = results.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : []
          );

          if (!responses.length) {
            throw new Error('No book discovery subjects were available');
          }

          const rejectedCount = results.length - responses.length;

          if (rejectedCount > 0) {
            logger.warn('Some book discovery subjects failed during blend', {
              label: 'Discover Books',
              failedSubjects: rejectedCount,
            });
          }

          const docsByKey = new Map<string, OpenLibrarySearchDoc>();

          responses
            .flatMap((response) => response.docs)
            .forEach((doc) => {
              const existingDoc = docsByKey.get(doc.key);

              if (
                !existingDoc ||
                scoreBookDoc(doc) > scoreBookDoc(existingDoc)
              ) {
                docsByKey.set(doc.key, doc);
              }
            });

          return {
            numFound: responses.reduce(
              (total, response) => total + response.numFound,
              0
            ),
            start: 0,
            docs: diversifyBookDocsByAuthor(
              [...docsByKey.values()].sort(
                (a, b) => scoreBookDoc(b) - scoreBookDoc(a)
              ),
              itemsPerPage
            ),
          };
        })
      : await openLibrary.searchBooks({
          query,
          page,
          limit: itemsPerPage,
          sort: openLibrarySort,
        });
    const sortedDocs =
      sortByValue === 'ranked' && !shouldBlendDefaultSubjects
        ? [...books.docs].sort((a, b) => scoreBookDoc(b) - scoreBookDoc(a))
        : books.docs;
    const ids = sortedDocs.map((doc) => doc.key.replace('/works/', ''));
    const identifiers = ids.length
      ? await getRepository(MediaIdentifier).find({
          where: {
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: In(ids),
          },
          relations: { media: { requests: true, watchlists: true } },
        })
      : [];
    const mediaByOpenLibraryId = new Map<string, MediaEntity>(
      identifiers
        .filter((identifier) => identifier.media.mediaType === MediaType.BOOK)
        .map((identifier) => {
          identifier.media.watchlists =
            identifier.media.watchlists?.filter(
              (watchlist) => watchlist.requestedBy.id === req.user?.id
            ) ?? [];

          return [identifier.value, identifier.media];
        })
    );

    return res.status(200).json({
      page,
      totalPages: Math.max(Math.ceil(books.numFound / itemsPerPage), 1),
      totalResults: books.numFound,
      results: sortedDocs.map((doc) => ({
        ...mapOpenLibrarySearchDoc(
          doc,
          mediaByOpenLibraryId.get(doc.key.replace('/works/', ''))
        ),
        score: scoreBookDoc(doc),
      })),
    });
  } catch (e) {
    logger.error('Failed to fetch book discovery results', {
      label: 'Discover Books',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return res.status(200).json(emptyDiscoverResponse(page));
  }
});

discoverRoutes.get<Record<string, unknown>, WatchlistResponse>(
  '/watchlist',
  async (req, res) => {
    const userRepository = getRepository(User);
    const itemsPerPage = 20;
    const page = req.query.page ? Number(req.query.page) : 1;

    const activeUser = await userRepository.findOne({
      where: { id: req.user?.id },
      select: ['id', 'plexToken'],
    });

    return res.json(
      await getCombinedWatchlist({
        userId: activeUser?.id,
        plexToken: activeUser?.plexToken,
        page,
        itemsPerPage,
      })
    );
  }
);

export default discoverRoutes;
