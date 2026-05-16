import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
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

discoverRoutes.get('/music', async (req, res, next) => {
  const listenBrainz = new ListenBrainzAPI();
  const musicBrainz = new MusicBrainz();
  const itemsPerPage = 20;
  const page = req.query.page ? Number(req.query.page) : 1;
  const days = req.query.days ? Number(req.query.days) : 7;
  const sortAscending = req.query.sortBy === 'release_date.asc';
  const query =
    typeof req.query.query === 'string' && req.query.query.trim()
      ? req.query.query.trim()
      : '';

  try {
    if (query) {
      const albums = await musicBrainz.searchAlbum({
        query,
        limit: itemsPerPage,
        offset: (page - 1) * itemsPerPage,
      });
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
        totalResults: albums.length,
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
        offset: 0,
        count: itemsPerPage,
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
        offset: 0,
        count: itemsPerPage,
      });
    }
    const releases = freshReleases.payload.releases
      .filter((release) => release.release_group_mbid && release.release_name)
      .sort((a, b) => {
        const left = a.release_date ?? '';
        const right = b.release_date ?? '';
        return sortAscending
          ? left.localeCompare(right)
          : right.localeCompare(left);
      })
      .slice(0, itemsPerPage);
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
          id: release.release_group_mbid,
          score: release.listen_count ?? 0,
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
        },
        relatedMedia.find((media) => media.mbId === release.release_group_mbid)
      )
    );

    return res.status(200).json({
      page,
      totalPages: 1,
      totalResults: releases.length,
      results,
    });
  } catch (e) {
    logger.error('Failed to fetch music discovery results', {
      label: 'Discover Music',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({ status: 500, message: 'Unable to fetch music discovery.' });
  }
});

discoverRoutes.get('/books', async (req, res, next) => {
  const openLibrary = new OpenLibraryAPI();
  const itemsPerPage = 20;
  const page = req.query.page ? Number(req.query.page) : 1;
  const query =
    typeof req.query.query === 'string' && req.query.query.trim()
      ? req.query.query.trim()
      : 'subject:fiction';

  try {
    const books = await openLibrary.searchBooks({
      query,
      page,
      limit: itemsPerPage,
    });
    const ids = books.docs.map((doc) => doc.key.replace('/works/', ''));
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
      totalPages: Math.ceil(books.numFound / itemsPerPage),
      totalResults: books.numFound,
      results: books.docs.map((doc) =>
        mapOpenLibrarySearchDoc(
          doc,
          mediaByOpenLibraryId.get(doc.key.replace('/works/', ''))
        )
      ),
    });
  } catch (e) {
    logger.error('Failed to fetch book discovery results', {
      label: 'Discover Books',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({ status: 500, message: 'Unable to fetch book discovery.' });
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
