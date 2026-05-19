#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const getApiTimeoutMs = () => {
  const timeoutMs = Number(process.env.HARDCOVER_API_TIMEOUT_MS ?? 30000);

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('HARDCOVER_API_TIMEOUT_MS must be a positive integer.');
  }

  return timeoutMs;
};

const getValidationLookupTerm = () =>
  normalizeText(
    process.env.HARDCOVER_VALIDATION_TERM ?? 'Foundation Isaac Asimov'
  );

const getMigrationMaxBooks = () => {
  const rawValue = process.env.HARDCOVER_MIGRATION_MAX_BOOKS;

  if (rawValue === undefined || rawValue === '') {
    return undefined;
  }

  const maxBooks = Number(rawValue);

  if (!Number.isInteger(maxBooks) || maxBooks <= 0) {
    throw new Error('HARDCOVER_MIGRATION_MAX_BOOKS must be a positive integer.');
  }

  return maxBooks;
};

const getRateLimitDelayMs = () => {
  const rawValue = process.env.HARDCOVER_RATE_LIMIT_DELAY_MS;

  if (rawValue === undefined || rawValue === '') {
    return 1500;
  }

  const delayMs = Number(rawValue);

  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error('HARDCOVER_RATE_LIMIT_DELAY_MS must be a non-negative integer.');
  }

  return delayMs;
};

const getRateLimitBatchSize = () => {
  const rawValue = process.env.HARDCOVER_RATE_LIMIT_BATCH_SIZE;

  if (rawValue === undefined || rawValue === '') {
    return 10;
  }

  const batchSize = Number(rawValue);

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('HARDCOVER_RATE_LIMIT_BATCH_SIZE must be a positive integer.');
  }

  return batchSize;
};

const getRateLimitMaxRetries = () => {
  const rawValue = process.env.HARDCOVER_RATE_LIMIT_MAX_RETRIES;

  if (rawValue === undefined || rawValue === '') {
    return 5;
  }

  const maxRetries = Number(rawValue);

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error('HARDCOVER_RATE_LIMIT_MAX_RETRIES must be a non-negative integer.');
  }

  return maxRetries;
};

const getRateLimitBackoffBaseMs = () => {
  const rawValue = process.env.HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS;

  if (rawValue === undefined || rawValue === '') {
    return 5000;
  }

  const baseMs = Number(rawValue);

  if (!Number.isInteger(baseMs) || baseMs <= 0) {
    throw new Error('HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS must be a positive integer.');
  }

  return baseMs;
};

const getLocalImportEnabled = () => {
  const rawValue = process.env.HARDCOVER_LOCAL_IMPORT;

  if (rawValue === undefined || rawValue === '') {
    return false;
  }

  return rawValue === 'true' || rawValue === '1' || rawValue === 'yes';
};

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

const normalizeComparableText = (value) => normalizeText(value).toLowerCase();

export const firstValue = (object, keys) => {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }

  return undefined;
};

const normalizeId = (value) =>
  value === undefined || value === null ? undefined : String(value);

const findBookEditions = (book, editions) => {
  const bookId = normalizeId(firstValue(book, ['Id', 'id', 'BookId', 'bookId']));

  return editions.filter((edition) => {
    const editionBookId = normalizeId(
      firstValue(edition, ['BookId', 'bookId', 'book_id'])
    );

    return bookId && editionBookId === bookId;
  });
};

const findAuthorForBook = (book, authors) => {
  const authorMetadataId = normalizeId(
    firstValue(book, [
      'AuthorMetadataId',
      'authorMetadataId',
      'AuthorMetadataID',
      'author_metadata_id',
    ])
  );
  const authorId = normalizeId(
    firstValue(book, ['AuthorId', 'authorId', 'AuthorID', 'author_id'])
  );

  return authors.find((candidate) => {
    const candidateMetadataId = normalizeId(
      firstValue(candidate, [
        'AuthorMetadataId',
        'authorMetadataId',
        'AuthorMetadataID',
        'author_metadata_id',
      ])
    );
    const candidateId = normalizeId(
      firstValue(candidate, [
        'Id',
        'id',
        'AuthorId',
        'authorId',
        'AuthorID',
        'author_id',
      ])
    );

    return (
      (authorMetadataId && candidateMetadataId === authorMetadataId) ||
      (authorId && candidateId === authorId)
    );
  });
};

export const extractIdentifiers = (book, editions) => {
  const candidates = [
    firstValue(book, ['Isbn13', 'ISBN13', 'isbn13']),
    firstValue(book, ['Isbn10', 'ISBN10', 'isbn10']),
    firstValue(book, ['Asin', 'ASIN', 'asin']),
    ...editions.flatMap((edition) => [
      firstValue(edition, ['Isbn13', 'ISBN13', 'isbn13']),
      firstValue(edition, ['Isbn10', 'ISBN10', 'isbn10']),
      firstValue(edition, ['Asin', 'ASIN', 'asin']),
    ]),
  ]
    .map((value) => normalizeText(String(value ?? '')))
    .filter(Boolean);

  return [...new Set(candidates)];
};

export const extractTagLabels = (book, tags) => {
  const tagIds = parseTags(firstValue(book, ['Tags', 'tags']));

  return tagIds
    .map((tagId) => findById(tags, tagId))
    .map((tag) => normalizeText(firstValue(tag, ['Label', 'label'])))
    .filter(Boolean);
};

const extractBookTitle = (book) =>
  normalizeText(
    firstValue(book, ['Title', 'title', 'CleanTitle', 'cleanTitle', 'Name', 'name'])
  );

const extractAuthorName = (book, authors, authorMetadata = []) => {
  const directAuthor = normalizeText(
    firstValue(book, [
      'AuthorName',
      'authorName',
      'AuthorTitle',
      'authorTitle',
      'Author',
      'author',
      'AuthorSort',
      'authorSort',
    ])
  );

  if (directAuthor) {
    return directAuthor;
  }

  const authorMetadataId = normalizeId(
    firstValue(book, [
      'AuthorMetadataId',
      'authorMetadataId',
      'AuthorMetadataID',
      'author_metadata_id',
    ])
  );
  const authorId = normalizeId(
    firstValue(book, ['AuthorId', 'authorId', 'AuthorID', 'author_id'])
  );
  const author = findAuthorForBook(
    {
      ...book,
      AuthorMetadataId: authorMetadataId,
      AuthorId: authorId,
    },
    authors
  );

  const authorName = normalizeText(
    firstValue(author, [
      'AuthorName',
      'authorName',
      'Name',
      'name',
      'Title',
      'title',
      'SortName',
      'sortName',
    ])
  );

  if (authorName) {
    return authorName;
  }

  const resolvedMetadataId = normalizeId(
    firstValue(author, [
      'AuthorMetadataId',
      'authorMetadataId',
      'AuthorMetadataID',
      'author_metadata_id',
    ]) ?? authorMetadataId
  );
  const metadata = authorMetadata.find((candidate) => {
    const candidateId = normalizeId(
      firstValue(candidate, [
        'Id',
        'id',
        'AuthorMetadataId',
        'authorMetadataId',
        'AuthorMetadataID',
        'author_metadata_id',
      ])
    );

    return resolvedMetadataId && candidateId === resolvedMetadataId;
  });

  return normalizeText(
    firstValue(metadata, [
      'AuthorName',
      'authorName',
      'Name',
      'name',
      'Title',
      'title',
      'SortName',
      'sortName',
    ])
  );
};

export const findById = (rows, id, idKeys = ['Id', 'id']) => {
  const normalizedId = normalizeId(id);

  if (!normalizedId) {
    return undefined;
  }

  return rows.find((row) =>
    idKeys.some((key) => normalizeId(row?.[key]) === normalizedId)
  );
};

const tagIdFromValue = (tag) => {
  if (Number.isInteger(tag)) {
    return tag;
  }

  if (typeof tag === 'string' && tag.trim()) {
    const parsed = Number(tag.trim());

    return Number.isInteger(parsed) ? parsed : undefined;
  }

  if (tag && typeof tag === 'object') {
    const parsed = Number(firstValue(tag, ['id', 'Id', 'tagId', 'TagId']));

    return Number.isInteger(parsed) ? parsed : undefined;
  }

  return undefined;
};

const pathWithTrailingSlash = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return '';
  }

  return normalized.endsWith('/') ? normalized : `${normalized}/`;
};

const normalizePathComparable = (value) => {
  const normalized = normalizeText(value);

  if (normalized === '/') {
    return normalized;
  }

  return normalized.replace(/\/+$/, '');
};

const deriveRootFolderPath = ({ book, author, rootFolders }) => {
  const direct = normalizeText(
    firstValue(book, [
      'RootFolderPath',
      'rootFolderPath',
      'RootFolder',
      'rootFolder',
      'RootFolderName',
      'rootFolderName',
      'Path',
      'path',
    ])
  );

  if (direct) {
    return direct;
  }

  const authorRoot = normalizeText(
    firstValue(author, ['RootFolderPath', 'rootFolderPath'])
  );

  if (authorRoot) {
    return authorRoot;
  }

  const authorPath = pathWithTrailingSlash(
    firstValue(author, ['Path', 'path'])
  );
  const matchingRootFolders = rootFolders
    .map((rootFolder) => normalizeText(firstValue(rootFolder, ['Path', 'path'])))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  return (
    matchingRootFolders.find((rootFolderPath) =>
      authorPath.startsWith(pathWithTrailingSlash(rootFolderPath))
    ) ?? normalizeText(firstValue(author, ['Path', 'path']))
  );
};

const ISBN10_REGEX = /^[0-9]{9}[0-9Xx]$/;
const ISBN13_REGEX = /^97[89][0-9]{10}$/;

const isIsbn = (identifier) =>
  ISBN10_REGEX.test(identifier) || ISBN13_REGEX.test(identifier);

const stripIsbnHyphens = (identifier) => identifier.replace(/-/g, '');

// Convert ISBN-10 to ISBN-13 using the standard algorithm.
const isbn10to13 = (isbn) => {
  const digits = isbn.replace(/[^0-9Xx]/g, '');
  if (digits.length !== 10) return null;

  const prefix = '978';
  const payload = prefix + digits.substring(0, 9);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum += parseInt(payload[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;

  return payload + check;
};

// Convert ISBN-13 to ISBN-10 by stripping the 978 prefix and recalculating check.
const isbn13to10 = (isbn) => {
  const digits = isbn.replace(/[^0-9]/g, '');
  if (digits.length !== 13 || !digits.startsWith('978')) return null;

  const payload = digits.substring(3, 12);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum += parseInt(payload[i]) * (10 - i);
  }
  const rem = sum % 11;
  const check = rem === 0 ? '0' : rem === 1 ? 'X' : String(11 - rem);

  return payload + check;
};

// Generate all lookup term variants for a single identifier.
// Returns an array of terms to try, ordered from most specific to least.
const lookupTermVariants = (identifier) => {
  const terms = new Set();

  if (!identifier) return [];

  const stripped = stripIsbnHyphens(String(identifier));

  if (isIsbn(stripped)) {
    // ISBN-10 variants
    if (ISBN10_REGEX.test(stripped)) {
      terms.add(`isbn:${stripped}`);
      terms.add(stripped);
      const converted = isbn10to13(stripped);
      if (converted) {
        terms.add(`isbn:${converted}`);
        terms.add(converted);
      }
    }

    // ISBN-13 variants
    if (ISBN13_REGEX.test(stripped)) {
      terms.add(`isbn:${stripped}`);
      terms.add(stripped);
      const converted = isbn13to10(stripped);
      if (converted) {
        terms.add(`isbn:${converted}`);
        terms.add(converted);
      }
    }
  } else {
    // Non-ISBN identifier (ASIN, Goodreads ID, etc.)
    terms.add(stripped);
    terms.add(`isbn:${stripped}`);
  }

  return [...terms].filter(Boolean);
};

const fetchWithTimeout = async (url, options = {}) => {
  const apiTimeoutMs = getApiTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiTimeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${apiTimeoutMs}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const parseRetryAfter = (headerValue) => {
  if (!headerValue) {
    return 0;
  }

  // If it's a plain number (including "0"), it's seconds.
  const trimmed = headerValue.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds * 1000;
  }

  // Otherwise, treat it as an HTTP-date (RFC 7231).
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const remaining = dateMs - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  return 0;
};

export const addJitter = (delayMs) => {
  // ±25% random jitter to avoid thundering herd.
  const jitterRange = delayMs * 0.25;
  const jitter = jitterRange * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(delayMs + jitter));
};

const fetchWithRetry = async (url, options = {}) => {
  const maxRetries = getRateLimitMaxRetries();
  const backoffBaseMs = getRateLimitBackoffBaseMs();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetchWithTimeout(url, options);

    if (response.status !== 429) {
      return response;
    }

    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
    let delayMs;

    if (retryAfterMs > 0) {
      delayMs = addJitter(retryAfterMs);
    } else {
      delayMs = addJitter(backoffBaseMs * Math.pow(2, attempt));
    }

    console.error(
      `Rate limited (429) for ${url}. ` +
      `Retry attempt ${attempt + 1}/${maxRetries}. ` +
      `Waiting ${Math.round(delayMs / 1000)}s before retry.`
    );

    await sleep(delayMs);
  }

  throw new Error(
    `Rate limited after ${maxRetries + 1} attempts: ${url}`
  );
};

const lookupBook = async ({ baseUrl, apiKey, term }) => {
  const url = new URL('/api/v1/book/lookup', baseUrl);
  url.searchParams.set('term', term);

  const response = await fetchWithRetry(url, {
    headers: {
      'X-Api-Key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Lookup failed for ${term}: ${response.status}`);
  }

  const body = await response.json();

  return Array.isArray(body) ? body : [];
};

const postJson = async ({ baseUrl, apiKey, endpoint, body }) => {
  const url = new URL(`/api/v1${endpoint}`, baseUrl);
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');

    throw new Error(
      `POST ${endpoint} failed: ${response.status}${responseBody ? ` ${responseBody}` : ''}`
    );
  }

  return response.json();
};

const putJson = async ({ baseUrl, apiKey, endpoint, body }) => {
  const url = new URL(`/api/v1${endpoint}`, baseUrl);
  const response = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');

    throw new Error(
      `PUT ${endpoint} failed: ${response.status}${responseBody ? ` ${responseBody}` : ''}`
    );
  }

  return response.json();
};

const getJson = async ({ baseUrl, apiKey, endpoint, searchParams }) => {
  const url = new URL(`/api/v1${endpoint}`, baseUrl);

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetchWithRetry(url, {
    headers: {
      'X-Api-Key': apiKey,
    },
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');

    throw new Error(
      `GET ${endpoint} failed: ${response.status}${responseBody ? ` ${responseBody}` : ''}`
    );
  }

  return response.json();
};

const resultTitle = (result) => normalizeComparableText(result?.title);

const resultAuthor = (result) =>
  normalizeComparableText(
    result?.author?.authorName ?? result?.authorTitle ?? result?.authorName
  );

// ---- Relaxed title comparison helpers ----

// Base normalization: lowercase, collapse whitespace, strip trailing period.
const normalizeRelaxedBase = (value) =>
  normalizeComparableText(value).replace(/\.+$/, '').trim();

// Strip apostrophes/right-quotes entirely (normalized + stripped variants).
const stripApostrophes = (value) => value.replace(/['\u2019\u2018\u02BC]/g, '');

// Strip leading articles ("a ", "an ", "the ").
const stripLeadingArticle = (value) => value.replace(/^(a |an |the )/i, '');

// Split on colon/semicolon, sort the parts alphabetically, rejoin, and trim.
// Handles swapped subtitle order (e.g. "Part 1: Siege" vs "Siege: Part 1").
const normalizeSplitSorted = (value) =>
  value
    .split(/[:;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(' ');

// Check whether one normalized title is a prefix of the other, indicating a
// subtitle difference (e.g. "Extra Lives" vs "Extra Lives: Why Video Games Matter").
const isPrefixMatch = (a, b) => {
  return a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a));
};

// Check whether one title's normalized form is contained wholly within the other
// as a substring (handles series prefix/suffix: "Dark Mirror" in "Star Trek: Dark Mirror").
const isContainedMatch = (a, b) => {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return false;
  return a.includes(b) || b.includes(a);
};

// Generate all relaxed variants of a title for comparison.
// Returns an array of forms, ordered by specificity.
const relaxedTitleVariants = (value) => {
  const base = normalizeRelaxedBase(value);
  const noApos = stripApostrophes(base);
  const noArticle = stripLeadingArticle(base);
  const sorted = normalizeSplitSorted(base);

  const forms = new Set();

  // Exact base form
  forms.add(base);

  // With apostrophes stripped
  if (noApos !== base) forms.add(noApos);

  // With leading article stripped
  if (noArticle !== base) forms.add(noArticle);

  // With both article stripped AND apostrophes stripped
  const noArtNoApos = stripApostrophes(noArticle);
  if (noArtNoApos !== base && noArtNoApos !== noApos && noArtNoApos !== noArticle) {
    forms.add(noArtNoApos);
  }

  // Prefix of each variant
  for (const variant of [...forms]) {
    // Strip common suffix patterns like " A Novel", subtitle from colon
    const colonIdx = variant.indexOf(':');
    if (colonIdx > 0) {
      forms.add(variant.substring(0, colonIdx).trim());
    }
    const semicolonIdx = variant.indexOf(';');
    if (semicolonIdx > 0) {
      forms.add(variant.substring(0, semicolonIdx).trim());
    }
  }

  // Split-sorted form (handles swapped subtitle order)
  if (sorted !== base) {
    forms.add(sorted);
    const sortedNoApos = stripApostrophes(sorted);
    if (sortedNoApos !== sorted) forms.add(sortedNoApos);
  }

  // Remove trailing " book x" or " part x" for clean prefix
  const trimmed = base
    .replace(/[-:,;]\s*(book\s+\d+|part\s+\d+|vol\.?\s*\d+|#\d+)\s*$/i, '')
    .trim();
  if (trimmed !== base && trimmed.length > 0) forms.add(trimmed);

  return [...forms];
};

// ---- End relaxed title comparison helpers ----

export const chooseStrictMatch = ({ source, candidates, identifier }) => {
  if (!candidates.length) {
    return { status: 'unmatched', reason: 'lookup_empty' };
  }

  const sourceTitle = normalizeComparableText(source.title);
  const sourceAuthor = normalizeComparableText(source.author);
  const exactCandidates = candidates.filter((candidate) => {
    const titleMatches = sourceTitle && resultTitle(candidate) === sourceTitle;
    const authorMatches =
      !sourceAuthor || resultAuthor(candidate) === sourceAuthor;

    return titleMatches && authorMatches;
  });

  if (exactCandidates.length === 1) {
    return {
      status: 'matched',
      reason: identifier
        ? 'identifier_exact_title_author'
        : 'title_author_exact',
      result: exactCandidates[0],
    };
  }

  if (exactCandidates.length > 1) {
    return {
      status: 'ambiguous',
      reason: 'multiple_exact_candidates',
      candidates: exactCandidates,
    };
  }

  // Fallback: when author matches, try a relaxed title comparison that accepts
  // subtitle differences, swapped subtitle order, leading articles, apostrophe
  // variants, series prefix/suffix, and minor punctuation.
  const sourceVariants = relaxedTitleVariants(source.title);
  const relaxedCandidates = candidates.filter((candidate) => {
    const authorMatches =
      !sourceAuthor || resultAuthor(candidate) === sourceAuthor;
    if (!authorMatches) {
      return false;
    }

    const candidateTitle = normalizeComparableText(candidate.title);
    if (!candidateTitle) {
      return false;
    }

    const candidateVariants = relaxedTitleVariants(candidate.title);

    // Check ANY variant matches (prefix, containment, or exact)
    for (const sv of sourceVariants) {
      if (!sv) continue;
      for (const cv of candidateVariants) {
        if (!cv) continue;
        if (
          sv === cv ||
          isPrefixMatch(sv, cv) ||
          isContainedMatch(sv, cv)
        ) {
          return true;
        }
      }
    }

    return false;
  });

  if (relaxedCandidates.length === 1) {
    return {
      status: 'matched',
      reason: identifier
        ? 'identifier_prefix_title_author'
        : 'title_author_prefix',
      result: relaxedCandidates[0],
    };
  }

  if (relaxedCandidates.length > 1) {
    return {
      status: 'ambiguous',
      reason: 'multiple_prefix_candidates',
      candidates: relaxedCandidates,
    };
  }

  return {
    status: candidates.length === 1 ? 'unmatched' : 'ambiguous',
    reason: identifier
      ? 'identifier_without_exact_title_author'
      : 'no_exact_title_author',
    candidates,
  };
};

export const buildSourceBook = ({ inventory, book }) => {
  const editions = Array.isArray(inventory.editions) ? inventory.editions : [];
  const authors = Array.isArray(inventory.authors) ? inventory.authors : [];
  const authorMetadata = Array.isArray(inventory.authorMetadata)
    ? inventory.authorMetadata
    : [];
  const qualityProfiles = Array.isArray(inventory.qualityProfiles)
    ? inventory.qualityProfiles
    : [];
  const metadataProfiles = Array.isArray(inventory.metadataProfiles)
    ? inventory.metadataProfiles
    : [];
  const tags = Array.isArray(inventory.tags) ? inventory.tags : [];
  const rootFolders = Array.isArray(inventory.rootFolders)
    ? inventory.rootFolders
    : [];
  const bookEditions = findBookEditions(book, editions);
  const identifiers = extractIdentifiers(book, bookEditions);
  const authorRecord = findAuthorForBook(book, authors);
  const qualityProfileId =
    firstValue(book, [
      'QualityProfileId',
      'qualityProfileId',
      'QualityProfileID',
      'quality_profile_id',
    ]) ??
    firstValue(authorRecord, [
      'QualityProfileId',
      'qualityProfileId',
      'QualityProfileID',
      'quality_profile_id',
    ]);
  const metadataProfileId =
    firstValue(book, [
      'MetadataProfileId',
      'metadataProfileId',
      'MetadataProfileID',
      'metadata_profile_id',
    ]) ??
    firstValue(authorRecord, [
      'MetadataProfileId',
      'metadataProfileId',
      'MetadataProfileID',
      'metadata_profile_id',
    ]);
  const qualityProfile = findById(qualityProfiles, qualityProfileId);
  const metadataProfile = findById(metadataProfiles, metadataProfileId);
  const sourceTags =
    firstValue(book, ['Tags', 'tags']) ??
    firstValue(authorRecord, ['Tags', 'tags']);

  return {
    serviceType: inventory.serviceType,
    id: firstValue(book, ['Id', 'id', 'BookId', 'bookId']),
    title: extractBookTitle(book),
    author: extractAuthorName(book, authors, authorMetadata),
    rootFolderPath: deriveRootFolderPath({
      book,
      author: authorRecord,
      rootFolders,
    }),
    qualityProfileId,
    qualityProfileName: normalizeText(
      firstValue(qualityProfile, ['Name', 'name'])
    ),
    metadataProfileId,
    metadataProfileName: normalizeText(
      firstValue(metadataProfile, ['Name', 'name'])
    ),
    monitored: firstValue(book, ['Monitored', 'monitored']),
    tags: sourceTags,
    tagLabels: extractTagLabels({ ...book, Tags: sourceTags }, tags),
    identifiers,
  };
};

export const buildInventorySources = (inventory) => {
  const books = Array.isArray(inventory.books) ? inventory.books : [];

  return books.map((book) => buildSourceBook({ inventory, book }));
};

const matchInventory = async ({ inventory, baseUrl, apiKey }) => {
  const matched = [];
  const unmatched = [];
  const ambiguous = [];
  const maxBooks = getMigrationMaxBooks();
  const books = (Array.isArray(inventory.books) ? inventory.books : []).slice(
    0,
    maxBooks
  );
  const batchSize = getRateLimitBatchSize();
  const delayMs = getRateLimitDelayMs();
  let requestCount = 0;
  let processedCount = 0;
  const totalBooks = books.length;

  const throttleIfNeeded = async () => {
    if (batchSize > 0 && requestCount > 0 && requestCount % batchSize === 0) {
      console.error(
        `[match] Batch limit reached (${requestCount} requests). ` +
        `Pausing ${delayMs}ms before next batch...`
      );
      await sleep(delayMs);
    }
  };

  const logProgress = () => {
    processedCount++;
    if (processedCount % Math.max(1, Math.floor(totalBooks / 10)) === 0 ||
        processedCount === totalBooks) {
      const pct = Math.round((processedCount / totalBooks) * 100);
      console.error(
        `[match] Progress: ${processedCount}/${totalBooks} books (${pct}%) - ` +
        `matched=${matched.length}, unmatched=${unmatched.length}, ambiguous=${ambiguous.length}`
      );
    }
  };

  for (const book of books) {
    const source = buildSourceBook({ inventory, book });

    if (!source.title) {
      unmatched.push({ source, reason: 'missing_source_title' });
      logProgress();
      continue;
    }

    let decision;
    let lookupTerm;

    // Collect all identifier variants to try (ISBN-10, ISBN-13, both with/without
    // hyphens, with/without "isbn:" prefix, etc.).
    const allTerms = new Set();
    for (const identifier of source.identifiers) {
      for (const variant of lookupTermVariants(identifier)) {
        allTerms.add(variant);
      }
    }

    for (const term of allTerms) {
      lookupTerm = term;
      let candidates;

      try {
        await throttleIfNeeded();
        requestCount++;
        candidates = await lookupBook({
          baseUrl,
          apiKey,
          term: lookupTerm,
        });
      } catch (error) {
        decision = {
          status: 'unmatched',
          reason: 'lookup_failed',
          error: error instanceof Error ? error.message : String(error),
        };
        break;
      }

      decision = chooseStrictMatch({ source, candidates, identifier: term });

      if (decision.status === 'matched') {
        break;
      }
    }

    if (decision?.status !== 'matched' && source.author) {
      lookupTerm = `${source.title} ${source.author}`;

      try {
        await throttleIfNeeded();
        requestCount++;
        const fallbackCandidates = await lookupBook({
          baseUrl,
          apiKey,
          term: lookupTerm,
        });
        decision = chooseStrictMatch({ source, candidates: fallbackCandidates });
      } catch (error) {
        // Keep the existing decision from the identifier loop;
        // the fallback just didn't work either.
      }
    }

    if (!decision) {
      unmatched.push({ source, reason: 'missing_identifier_or_author' });
    } else if (decision.status === 'matched') {
      matched.push({
        source,
        lookupTerm,
        reason: decision.reason,
        hardcover: decision.result,
      });
    } else if (decision.status === 'ambiguous') {
      ambiguous.push({
        source,
        lookupTerm,
        reason: decision.reason,
        candidates: decision.candidates,
      });
    } else {
      unmatched.push({
        source,
        lookupTerm,
        reason: decision.reason,
        error: decision.error,
        candidates: decision.candidates,
      });
    }

    logProgress();
  }

  return { matched, unmatched, ambiguous };
};

export function parseTags(value) {
  if (Array.isArray(value)) {
    return value.map(tagIdFromValue).filter((tag) => tag !== undefined);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.map(tagIdFromValue).filter((tag) => tag !== undefined)
      : [];
  } catch {
    return value
      .split(',')
      .map((tag) => Number(tag.trim()))
      .filter((tag) => Number.isInteger(tag));
  }
}

const boolFromSource = (value, fallback = true) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return !['0', 'false', 'False'].includes(value);
  }

  return fallback;
};

// Synthesize a Hardcover-compatible entry from Readarr source metadata for
// books that were not found in the Hardcover API.  Uses deterministic local
// IDs derived from ISBN or a hash of title+author so the entry can be added
// as-is to a Bookshelf target.  The target will attempt to fetch metadata
// from Hardcover for this ID and fail gracefully, retaining the provided
// fields.
const synthesizeLocalEntry = (source) => {
  // Use the first ISBN-13 as the primary foreign identifier when available;
  // otherwise derive a stable ID from the title+author.
  const isbn13 = source.identifiers.find(
    (id) => id.length === 13 && /^97[89]/.test(id)
  );
  const fallbackId = `local:${normalizeComparableText(`${source.title}:${source.author}`).replace(/\s+/g, '-')}`;

  const foreignBookId = isbn13 ? `isbn:${isbn13}` : fallbackId;
  const foreignAuthorId = `local:${normalizeComparableText(source.author).replace(/\s+/g, '-')}`;

  // Build at least one edition so the rebuild validation passes.
  const editionIsbn = source.identifiers[0] || fallbackId;
  const foreignEditionId = isIsbn(stripIsbnHyphens(editionIsbn))
    ? `isbn:${stripIsbnHyphens(editionIsbn)}`
    : editionIsbn;

  return {
    foreignBookId,
    title: source.title,
    author: {
      foreignAuthorId,
      authorName: source.author,
    },
    editions: [
      {
        foreignEditionId,
        title: source.title,
        monitored: boolFromSource(source.monitored, true),
      },
    ],
  };
};

const buildAddPayload = (match) => {
  const rootFolderPath = normalizeText(match.source.rootFolderPath);
  const qualityProfileId = Number(match.source.qualityProfileId || 0);
  const metadataProfileId = Number(match.source.metadataProfileId || 0) || 1;
  const monitored = boolFromSource(match.source.monitored, true);
  const hardcover = match.hardcover;

  return {
    serviceType: match.source.serviceType,
    source: match.source,
    lookupTerm: match.lookupTerm,
    addBook: {
      ...hardcover,
      monitored,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath,
      tags: [],
      author: {
        ...hardcover.author,
        rootFolderPath,
        qualityProfileId,
        metadataProfileId,
        monitored: false,
        addOptions: {
          monitor: 'none',
          searchForMissingBooks: false,
        },
        manualAdd: true,
      },
      editions: Array.isArray(hardcover.editions) ? hardcover.editions : [],
      addOptions: {
        searchForNewBook: false,
      },
    },
  };
};

const validateRebuildSource = (match) => {
  const missing = [];

  if (!normalizeText(match.source.rootFolderPath)) {
    missing.push('rootFolderPath');
  }

  if (!Number(match.source.qualityProfileId || 0)) {
    missing.push('qualityProfileId');
  }

  if (!match.hardcover?.foreignBookId) {
    missing.push('hardcover.foreignBookId');
  }

  if (!match.hardcover?.author?.foreignAuthorId) {
    missing.push('hardcover.author.foreignAuthorId');
  }

  if (
    !Array.isArray(match.hardcover?.editions) ||
    !match.hardcover.editions.length
  ) {
    missing.push('hardcover.editions');
  }

  return missing;
};

export const buildRebuildArtifacts = (matched) => {
  const rebuildPayload = [];
  const rebuildBlocked = [];

  for (const match of matched) {
    const missing = validateRebuildSource(match);

    if (missing.length) {
      rebuildBlocked.push({
        source: match.source,
        lookupTerm: match.lookupTerm,
        reason: 'missing_required_rebuild_fields',
        missing,
      });
      continue;
    }

    rebuildPayload.push(buildAddPayload(match));
  }

  return { rebuildPayload, rebuildBlocked };
};

const applyRebuildPayload = async ({ migrationDir, jobs }) => {
  const rebuildPayload = await readJson(
    path.join(migrationDir, 'rebuild-payload.json')
  );
  const applied = [];
  const failed = [];
  const monitorUpdates = new Map();
  const targetCache = new Map();
  const batchSize = getRateLimitBatchSize();
  const delayMs = getRateLimitDelayMs();
  let requestCount = 0;
  const totalItems = rebuildPayload.length;

  const throttleIfNeeded = async () => {
    if (batchSize > 0 && requestCount > 0 && requestCount % batchSize === 0) {
      console.error(
        `[apply] Batch limit reached (${requestCount} requests). ` +
        `Pausing ${delayMs}ms before next batch...`
      );
      await sleep(delayMs);
    }
  };

  const logProgress = (index) => {
    const processedCount = index + 1;
    if (totalItems <= 1 ||
        processedCount % Math.max(1, Math.floor(totalItems / 10)) === 0 ||
        processedCount === totalItems) {
      const pct = Math.round((processedCount / totalItems) * 100);
      console.error(
        `[apply] Progress: ${processedCount}/${totalItems} books (${pct}%) - ` +
        `applied=${applied.length}, failed=${failed.length}`
      );
    }
  };

  const getTargetConfig = async (job) => {
    if (targetCache.has(job.serviceType)) {
      return targetCache.get(job.serviceType);
    }

    const [qualityProfiles, metadataProfiles, rootFolders, tags] =
      await Promise.all([
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/qualityProfile',
        }),
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/metadataProfile',
        }).catch(() => []),
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/rootfolder',
        }),
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/tag',
        }).catch(() => []),
      ]);
    const config = {
      qualityProfiles: Array.isArray(qualityProfiles) ? qualityProfiles : [],
      metadataProfiles: Array.isArray(metadataProfiles) ? metadataProfiles : [],
      rootFolders: Array.isArray(rootFolders) ? rootFolders : [],
      tags: Array.isArray(tags) ? tags : [],
    };

    targetCache.set(job.serviceType, config);

    return config;
  };

  const resolveTargetIds = async (item, job, targetConfig) => {
    const qualityProfile = item.source.qualityProfileName
      ? targetConfig.qualityProfiles.find(
          (profile) =>
            normalizeComparableText(profile.name ?? profile.Name) ===
            normalizeComparableText(item.source.qualityProfileName)
        )
      : findById(targetConfig.qualityProfiles, item.addBook.qualityProfileId, [
          'id',
          'Id',
        ]);
    const metadataProfile = item.source.metadataProfileName
      ? targetConfig.metadataProfiles.find(
          (profile) =>
            normalizeComparableText(profile.name ?? profile.Name) ===
            normalizeComparableText(item.source.metadataProfileName)
        )
      : findById(
          targetConfig.metadataProfiles,
          item.addBook.metadataProfileId,
          ['id', 'Id']
        );
    let rootFolder = targetConfig.rootFolders.find(
      (folder) =>
        normalizePathComparable(folder.path ?? folder.Path) ===
        normalizePathComparable(item.addBook.rootFolderPath)
    );
    const missing = [];

    if (!qualityProfile?.id && !qualityProfile?.Id) {
      missing.push(
        `qualityProfile:${item.source.qualityProfileName || item.addBook.qualityProfileId}`
      );
    }

    if (!metadataProfile?.id && !metadataProfile?.Id) {
      missing.push(
        `metadataProfile:${item.source.metadataProfileName || item.addBook.metadataProfileId}`
      );
    }

    if (!rootFolder) {
      const createdRootFolder = await postJson({
        baseUrl: job.baseUrl,
        apiKey: job.apiKey,
        endpoint: '/rootfolder',
        body: {
          path: item.addBook.rootFolderPath,
          name:
            item.addBook.rootFolderPath.split('/').filter(Boolean).pop() ??
            'Books',
          defaultQualityProfileId: Number(
            qualityProfile.id ?? qualityProfile.Id
          ),
          defaultMetadataProfileId: Number(
            metadataProfile.id ?? metadataProfile.Id
          ),
          defaultMonitorOption: 0,
          defaultNewItemMonitorOption: 0,
          defaultTags: [],
          isCalibreLibrary: false,
          calibreSettings: {},
        },
      });
      targetConfig.rootFolders.push(createdRootFolder);
      rootFolder = createdRootFolder;
    }

    if (missing.length) {
      throw new Error(`Target configuration missing ${missing.join(', ')}`);
    }

    return {
      qualityProfileId: Number(qualityProfile.id ?? qualityProfile.Id),
      metadataProfileId: Number(metadataProfile.id ?? metadataProfile.Id),
    };
  };

  const resolveTargetTags = async (item, job, targetConfig) => {
    const labels = Array.isArray(item.source.tagLabels)
      ? item.source.tagLabels
      : [];
    const tagIds = [];

    for (const label of labels) {
      const existing = targetConfig.tags.find(
        (tag) =>
          normalizeComparableText(tag.label ?? tag.Label) ===
          normalizeComparableText(label)
      );

      if (existing?.id || existing?.Id) {
        tagIds.push(Number(existing.id ?? existing.Id));
        continue;
      }

      const created = await postJson({
        baseUrl: job.baseUrl,
        apiKey: job.apiKey,
        endpoint: '/tag',
        body: { label },
      });
      targetConfig.tags.push(created);
      tagIds.push(Number(created.id ?? created.Id));
    }

    return tagIds;
  };

  for (let i = 0; i < rebuildPayload.length; i++) {
    const item = rebuildPayload[i];
    const job = jobs.find(
      (candidate) => candidate.serviceType === item.serviceType
    );

    if (!job?.apiKey) {
      failed.push({
        source: item.source,
        serviceType: item.serviceType,
        reason: 'hardcover_api_key_not_provided',
      });
      logProgress(i);
      continue;
    }

    const isRecoverableConstraintError = (err) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes('409') &&
        message.includes('UNIQUE constraint') &&
        (message.includes('ForeignEditionId') || message.includes('TitleSlug'))
      );
    };

    let addBook;
    let postSucceeded = false;
    let result;

    try {
      await throttleIfNeeded();
      requestCount++;
      const targetConfig = await getTargetConfig(job);
      const targetIds = await resolveTargetIds(item, job, targetConfig);
      const tags = await resolveTargetTags(item, job, targetConfig);
      addBook = {
        ...item.addBook,
        qualityProfileId: targetIds.qualityProfileId,
        metadataProfileId: targetIds.metadataProfileId,
        tags,
        author: {
          ...item.addBook.author,
          qualityProfileId: targetIds.qualityProfileId,
          metadataProfileId: targetIds.metadataProfileId,
        },
      };
      await throttleIfNeeded();
      requestCount++;
      result = await postJson({
        baseUrl: job.baseUrl,
        apiKey: job.apiKey,
        endpoint: '/book',
        body: addBook,
      });
      postSucceeded = true;
    } catch (postError) {
      // 409 constraint on ForeignEditionId means the edition already exists in
      // the target (another book from the same author was added earlier in this
      // run, expanding the author into many unmonitored books). The book may
      // already be in the target; recover by looking it up post-facto.
      if (!isRecoverableConstraintError(postError)) {
        failed.push({
          source: item.source,
          serviceType: item.serviceType,
          reason:
            postError instanceof Error ? postError.message : String(postError),
        });
        logProgress(i);
        continue;
      }
    }

    // Resolve the target book ID from POST result or by searching the target.
    let targetBookId;

    try {
      // If POST succeeded, prefer the returned id immediately.
      if (postSucceeded && result) {
        targetBookId = result.id ?? result.Id;
      }

      // If we still don't have an id (409 path), search the target.
      if (targetBookId === undefined) {
        await throttleIfNeeded();
        requestCount++;
        const targetBooks = await getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/book',
        });
        const targetBook = (
          Array.isArray(targetBooks) ? targetBooks : []
        ).find(
          (book) =>
            normalizeId(book.foreignBookId ?? book.ForeignBookId) ===
              normalizeId(item.addBook.foreignBookId) ||
            normalizeComparableText(book.title ?? book.Title) ===
              normalizeComparableText(
                item.addBook.title ?? addBook?.title ?? ''
              )
        );

        targetBookId = targetBook?.id ?? targetBook?.Id;
      }

      if (targetBookId !== undefined) {
        const monitorKey = `${job.serviceType}:${boolFromSource(
          item.source.monitored,
          true
        )}`;
        const existing = monitorUpdates.get(monitorKey) ?? {
          job,
          monitored: boolFromSource(item.source.monitored, true),
          bookIds: [],
        };
        existing.bookIds.push(Number(targetBookId));
        monitorUpdates.set(monitorKey, existing);

        applied.push({
          source: item.source,
          serviceType: item.serviceType,
          hardcoverBookId: targetBookId,
          title: result?.title ?? item.addBook.title,
        });
      } else {
        failed.push({
          source: item.source,
          serviceType: item.serviceType,
          reason: 'not_found_in_target_after_post',
        });
      }
    } catch (lookupError) {
      failed.push({
        source: item.source,
        serviceType: item.serviceType,
        reason:
          lookupError instanceof Error
            ? lookupError.message
            : String(lookupError),
      });
    }

    logProgress(i);
  }

  for (const update of monitorUpdates.values()) {
    try {
      const bookIds = [...new Set(update.bookIds)];
      await putJson({
        baseUrl: update.job.baseUrl,
        apiKey: update.job.apiKey,
        endpoint: '/book/monitor',
        body: {
          bookIds,
          monitored: update.monitored,
        },
      });

      if (update.monitored) {
        await sleep(1000);
        const books = await getJson({
          baseUrl: update.job.baseUrl,
          apiKey: update.job.apiKey,
          endpoint: '/book',
        });
        const stillUnmonitored = bookIds.filter((bookId) => {
          const book = (Array.isArray(books) ? books : []).find(
            (candidate) => Number(candidate.id ?? candidate.Id) === bookId
          );

          return book && book.monitored !== true && book.Monitored !== true;
        });

        if (stillUnmonitored.length) {
          await putJson({
            baseUrl: update.job.baseUrl,
            apiKey: update.job.apiKey,
            endpoint: '/book/monitor',
            body: {
              bookIds: stillUnmonitored,
              monitored: true,
            },
          });
        }
      }
    } catch (error) {
      failed.push({
        serviceType: update.job.serviceType,
        reason: error instanceof Error ? error.message : String(error),
        bookIds: update.bookIds,
      });
    }
  }

  await writeJson(path.join(migrationDir, 'applied-books.json'), applied);
  await writeJson(path.join(migrationDir, 'apply-failures.json'), failed);

  const report = await readJson(
    path.join(migrationDir, 'migration-report.json')
  );
  report.status = failed.length ? 'apply_incomplete' : 'apply_complete';
  report.applyCounts = {
    applied: applied.length,
    failed: failed.length,
  };
  await writeJson(path.join(migrationDir, 'migration-report.json'), report);
};

const classifyProvider = (metadataSource) => {
  const normalized = normalizeComparableText(metadataSource);

  if (normalized.includes('hardcover')) {
    return 'hardcover';
  }

  if (
    normalized.includes('goodreads') ||
    normalized.includes('rreading-glasses') ||
    normalized.includes('127.0.0.1:8790') ||
    normalized.includes('localhost:8790')
  ) {
    return 'softcover';
  }

  return 'unknown';
};

const validateTarget = async ({ migrationDir, jobs }) => {
  const applied = await readJson(
    path.join(migrationDir, 'applied-books.json')
  ).catch(() => []);
  const validation = [];
  const validationLookupTerm = getValidationLookupTerm();

  for (const job of jobs) {
    if (!job.apiKey) {
      validation.push({
        serviceType: job.serviceType,
        ok: false,
        reason: 'hardcover_api_key_not_provided',
      });
      continue;
    }

    try {
      const [development, books, lookup] = await Promise.all([
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/config/development',
        }).catch((error) => ({ error: String(error) })),
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/book',
        }),
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/book/lookup',
          searchParams: { term: validationLookupTerm },
        }).catch(() => []),
      ]);
      const provider = classifyProvider(development?.metadataSource);
      const appliedForService = applied.filter(
        (item) => item.serviceType === job.serviceType
      );
      const bookIds = new Set(
        (Array.isArray(books) ? books : []).map((book) => Number(book.id))
      );
      const missingApplied = appliedForService.filter(
        (item) =>
          item.hardcoverBookId !== undefined &&
          !bookIds.has(Number(item.hardcoverBookId))
      );
      const lookupResults = Array.isArray(lookup) ? lookup : [];

      validation.push({
        serviceType: job.serviceType,
        ok:
          provider === 'hardcover' &&
          missingApplied.length === 0 &&
          lookupResults.length > 0,
        provider,
        metadataSource: development?.metadataSource,
        bookCount: Array.isArray(books) ? books.length : 0,
        appliedCount: appliedForService.length,
        missingApplied,
        lookupTerm: validationLookupTerm,
        lookupCount: lookupResults.length,
      });
    } catch (error) {
      validation.push({
        serviceType: job.serviceType,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await writeJson(
    path.join(migrationDir, 'validation-report.json'),
    validation
  );

  const report = await readJson(
    path.join(migrationDir, 'migration-report.json')
  );
  const ok = validation.every((result) => result.ok);
  report.status = ok ? 'validation_complete' : 'validation_failed';
  report.validation = {
    ok,
    services: validation.map((result) => ({
      serviceType: result.serviceType,
      ok: result.ok,
      provider: result.provider,
      lookupCount: result.lookupCount,
      lookupTerm: result.lookupTerm,
      missingAppliedCount: result.missingApplied?.length ?? 0,
      reason: result.reason,
    })),
  };
  await writeJson(path.join(migrationDir, 'migration-report.json'), report);
};

const checkCutoverReadiness = async ({ migrationDir }) => {
  const [report, applyFailures, validation] = await Promise.all([
    readJson(path.join(migrationDir, 'migration-report.json')),
    readJson(path.join(migrationDir, 'apply-failures.json')).catch(() => []),
    readJson(path.join(migrationDir, 'validation-report.json')).catch(() => []),
  ]);
  const rebuildBlocked = await readJson(
    path.join(migrationDir, 'rebuild-blocked.json')
  ).catch(() => []);
  const reasons = [];

  if (report.status !== 'validation_complete') {
    reasons.push(`migration_status_${report.status ?? 'unknown'}`);
  }

  if (report.validation?.ok !== true) {
    reasons.push('validation_not_ok');
  }

  if (Array.isArray(applyFailures) && applyFailures.length > 0) {
    reasons.push('apply_failures_present');
  }

  if (Array.isArray(rebuildBlocked) && rebuildBlocked.length > 0) {
    reasons.push('rebuild_blocked_present');
  }

  const failedServices = Array.isArray(validation)
    ? validation.filter((item) => !item.ok)
    : [];

  if (failedServices.length > 0) {
    reasons.push('failed_service_validation_present');
  }

  const decision = {
    ok: reasons.length === 0,
    reasons,
    status: report.status,
    validation: report.validation,
    applyCounts: report.applyCounts,
  };

  await writeJson(path.join(migrationDir, 'cutover-decision.json'), decision);

  if (!decision.ok) {
    throw new Error(`Cutover not ready: ${reasons.join(', ')}`);
  }
};

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, 'utf8'));

const writeJson = async (filePath, value) => {
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(`${filePath}.tmp`, filePath);
};

const printSummary = async ({ migrationDir }) => {
  const report = await readJson(
    path.join(migrationDir, 'migration-report.json')
  );
  const decision = await readJson(
    path.join(migrationDir, 'cutover-decision.json')
  ).catch(() => undefined);

  console.log(`Migration status: ${report.status ?? 'unknown'}`);

  if (report.counts) {
    console.log(
      `Match counts: matched=${report.counts.matched ?? 0}, local=${report.counts.localImported ?? 0}, unmatched=${report.counts.unmatched ?? 0}, ambiguous=${report.counts.ambiguous ?? 0}, rebuildPayload=${report.counts.rebuildPayload ?? 0}, rebuildBlocked=${report.counts.rebuildBlocked ?? 0}`
    );
  }

  if (report.applyCounts) {
    console.log(
      `Apply counts: applied=${report.applyCounts.applied ?? 0}, failed=${report.applyCounts.failed ?? 0}`
    );
  }

  if (report.validation) {
    console.log(`Validation: ${report.validation.ok ? 'ok' : 'failed'}`);
  }

  if (decision) {
    console.log(
      `Cutover ready: ${decision.ok ? 'yes' : `no (${(decision.reasons ?? []).join(', ') || 'unknown'})`}`
    );
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const validate = args.includes('--validate');
  const cutoverCheck = args.includes('--cutover-check');
  const summary = args.includes('--summary');
  const migrationDir = args.find(
    (arg) =>
      arg !== '--apply' &&
      arg !== '--validate' &&
      arg !== '--cutover-check' &&
      arg !== '--summary'
  );

  if (!migrationDir) {
    throw new Error(
      'Usage: bookshelf-hardcover-migration.mjs [--apply|--validate|--cutover-check|--summary] <migration-dir>'
    );
  }

  getApiTimeoutMs();

  const jobs = [
    {
      serviceType: 'ebook',
      inventoryFile: 'ebook-inventory.json',
      baseUrl:
        process.env.HARDCOVER_EBOOK_BASE_URL ??
        `http://127.0.0.1:${process.env.BOOKSHELF_EBOOKS_PORT ?? '8787'}`,
      apiKey: process.env.HARDCOVER_EBOOK_API_KEY ?? process.env.EBOOK_API_KEY,
    },
    {
      serviceType: 'audiobook',
      inventoryFile: 'audiobook-inventory.json',
      baseUrl:
        process.env.HARDCOVER_AUDIOBOOK_BASE_URL ??
        `http://127.0.0.1:${process.env.BOOKSHELF_AUDIOBOOKS_PORT ?? '8788'}`,
      apiKey:
        process.env.HARDCOVER_AUDIOBOOK_API_KEY ??
        process.env.AUDIOBOOK_API_KEY,
    },
  ];

  if (apply) {
    await applyRebuildPayload({ migrationDir, jobs });
    return;
  }

  if (validate) {
    await validateTarget({ migrationDir, jobs });
    return;
  }

  if (cutoverCheck) {
    await checkCutoverReadiness({ migrationDir });
    return;
  }

  if (summary) {
    await printSummary({ migrationDir });
    return;
  }

  const allMatched = [];
  const allUnmatched = [];
  const allAmbiguous = [];

  for (const job of jobs) {
    const inventory = await readJson(
      path.join(migrationDir, job.inventoryFile)
    );

    if (!job.apiKey) {
      allUnmatched.push(
        ...buildInventorySources(inventory).map((source) => ({
          source,
          reason: 'hardcover_api_key_not_provided',
        }))
      );
      continue;
    }

    const result = await matchInventory({
      inventory,
      baseUrl: job.baseUrl,
      apiKey: job.apiKey,
    });

    allMatched.push(...result.matched);
    allUnmatched.push(...result.unmatched);
    allAmbiguous.push(...result.ambiguous);
  }

  await writeJson(path.join(migrationDir, 'matched-books.json'), allMatched);
  await writeJson(
    path.join(migrationDir, 'unmatched-books.json'),
    allUnmatched
  );
  await writeJson(
    path.join(migrationDir, 'ambiguous-books.json'),
    allAmbiguous
  );
  const localEntries = [];

  if (getLocalImportEnabled()) {
    for (const entry of allUnmatched) {
      if (!entry.source) continue;

      const local = synthesizeLocalEntry(entry.source);

      localEntries.push({
        status: 'matched',
        reason: 'local_synthesis',
        source: entry.source,
        hardcover: local,
        lookupTerm: `local:${entry.source.title} ${entry.source.author}`,
      });
    }
  }

  const rebuildSources = allMatched.concat(localEntries);

  const { rebuildPayload, rebuildBlocked } = buildRebuildArtifacts(
    rebuildSources
  );
  await writeJson(
    path.join(migrationDir, 'rebuild-payload.json'),
    rebuildPayload
  );
  await writeJson(
    path.join(migrationDir, 'rebuild-blocked.json'),
    rebuildBlocked
  );

  const report = await readJson(
    path.join(migrationDir, 'migration-report.json')
  );
  report.status = 'matching_complete';
  report.counts = {
    matched: allMatched.length,
    localImported: localEntries.length,
    unmatched: allUnmatched.length,
    ambiguous: allAmbiguous.length,
    rebuildPayload: rebuildPayload.length,
    rebuildBlocked: rebuildBlocked.length,
  };
  report.matchingPolicy =
    'ISBN/ASIN lookup first with ISBN-10⇔13 conversion; exact title and author; prefix/subtitle/colon/containment relaxed matching when author agrees. Title+author fallback when identifiers fail. Local synthesis for unmatched books when HARDCOVER_LOCAL_IMPORT is enabled.';
  await writeJson(path.join(migrationDir, 'migration-report.json'), report);
  await writeJson(path.join(migrationDir, 'applied-books.json'), []);
  await writeJson(path.join(migrationDir, 'apply-failures.json'), []);
  await writeJson(path.join(migrationDir, 'validation-report.json'), []);
  await writeJson(path.join(migrationDir, 'cutover-decision.json'), {
    ok: false,
    reasons: ['validation_not_run'],
  });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
