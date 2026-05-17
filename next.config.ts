import type { NextConfig } from 'next';

const ONE_DAY = 24 * 60 * 60;
const THIRTY_DAYS = 30 * ONE_DAY;
const ONE_DAY_STATIC_CACHE = `public, max-age=${ONE_DAY}, stale-while-revalidate=${THIRTY_DAYS}, stale-if-error=${ONE_DAY}`;
const THIRTY_DAY_STATIC_CACHE = `public, max-age=${THIRTY_DAYS}, stale-while-revalidate=${THIRTY_DAYS}, stale-if-error=${ONE_DAY}`;

const nextConfig: NextConfig = {
  env: {
    commitTag: process.env.COMMIT_TAG || 'local',
  },
  async headers() {
    return [
      {
        source:
          '/:path*\\.(aac|avif|css|flac|gif|ico|jpg|jpeg|js|m4a|map|mjs|mp3|mp4|oga|ogg|ogv|opus|otf|png|svg|ttf|wasm|wav|webm|webp|woff|woff2)',
        headers: [
          {
            key: 'Cache-Control',
            value: THIRTY_DAY_STATIC_CACHE,
          },
        ],
      },
      {
        source: '/:path*\\.(json|txt|vtt|xml)',
        headers: [
          {
            key: 'Cache-Control',
            value: THIRTY_DAY_STATIC_CACHE,
          },
        ],
      },
      {
        source: '/offline.html',
        headers: [
          {
            key: 'Cache-Control',
            value: ONE_DAY_STATIC_CACHE,
          },
        ],
      },
      {
        source: '/:path(site.webmanifest|robots.txt)',
        headers: [
          {
            key: 'Cache-Control',
            value: ONE_DAY_STATIC_CACHE,
          },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { hostname: 'gravatar.com' },
      { hostname: 'image.tmdb.org' },
      { hostname: 'artworks.thetvdb.com' },
      { hostname: 'coverartarchive.org' },
      { hostname: 'covers.openlibrary.org' },
      { hostname: 'plex.tv' },
    ],
  },
  transpilePackages: ['country-flag-icons'],
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/i,
      issuer: /\.[jt]sx?$/,
      use: ['@svgr/webpack'],
    });

    return config;
  },
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  experimental: {
    scrollRestoration: true,
    largePageDataBytes: 512 * 1000,
  },
};

export default nextConfig;
