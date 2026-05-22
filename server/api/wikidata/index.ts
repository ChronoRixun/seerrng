import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { normalizeValidIsbn } from '@server/lib/isbn';

type WikidataSparqlBinding = {
  type: string;
  value: string;
  'xml:lang'?: string;
};

type WikidataSparqlResponse = {
  results: {
    bindings: Record<string, WikidataSparqlBinding>[];
  };
};

export type WikidataCanonicalBookTerm = {
  title: string;
  authorName?: string;
  isbn13?: string;
};

const MAX_WIKIDATA_TITLE_LENGTH = 300;

const escapeSparqlString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const normalizeComparableText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();

const uniqTerms = (
  terms: WikidataCanonicalBookTerm[]
): WikidataCanonicalBookTerm[] => {
  const seen = new Set<string>();
  const unique: WikidataCanonicalBookTerm[] = [];

  for (const term of terms) {
    const key = [
      normalizeComparableText(term.title),
      term.authorName ? normalizeComparableText(term.authorName) : '',
      term.isbn13 ?? '',
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(term);
  }

  return unique;
};

class WikidataAPI extends ExternalAPI {
  constructor() {
    super(
      'https://query.wikidata.org',
      {},
      {
        headers: {
          'User-Agent': 'SeerrNG/0.1.0 (https://github.com/snapetech/seerrng)',
          Accept: 'application/sparql-results+json',
        },
        nodeCache: cacheManager.getCache('wikidata').data,
        rateLimit: {
          maxRequests: 1,
          maxRPS: 1,
        },
      }
    );
  }

  public async getCanonicalBookTerms({
    title,
    authorName,
  }: {
    title: string;
    authorName?: string;
  }): Promise<WikidataCanonicalBookTerm[]> {
    const trimmedTitle = title.trim();

    if (!trimmedTitle || trimmedTitle.length > MAX_WIKIDATA_TITLE_LENGTH) {
      return [];
    }

    const query = `
SELECT ?canonicalTitle ?authorLabel ?isbn13 WHERE {
  ?item rdfs:label ?matchedLabel .
  FILTER(LCASE(STR(?matchedLabel)) = LCASE("${escapeSparqlString(trimmedTitle)}"))
  OPTIONAL { ?item wdt:P629 ?editionOf . }
  BIND(COALESCE(?editionOf, ?item) AS ?canonical)
  {
    ?canonical rdfs:label ?canonicalTitle .
    FILTER(LANG(?canonicalTitle) = "en")
  }
  UNION
  {
    ?canonical wdt:P1476 ?canonicalTitle .
    FILTER(LANG(?canonicalTitle) = "en")
  }
  OPTIONAL {
    ?canonical (wdt:P50|wdt:P110) ?author .
    ?author rdfs:label ?authorLabel .
    FILTER(LANG(?authorLabel) = "en")
  }
  OPTIONAL { ?canonical wdt:P212 ?isbn13 . }
}
LIMIT 25`;

    const data = await this.get<WikidataSparqlResponse>(
      '/sparql',
      {
        params: {
          format: 'json',
          query,
        },
      },
      43200
    );
    const normalizedAuthorName = authorName
      ? normalizeComparableText(authorName)
      : undefined;
    const terms = data.results.bindings
      .map((binding): WikidataCanonicalBookTerm | undefined => {
        const canonicalTitle = binding.canonicalTitle?.value?.trim();

        if (!canonicalTitle) {
          return undefined;
        }

        const resolvedAuthorName = binding.authorLabel?.value?.trim();

        if (
          normalizedAuthorName &&
          resolvedAuthorName &&
          normalizeComparableText(resolvedAuthorName) !== normalizedAuthorName
        ) {
          return undefined;
        }

        return {
          title: canonicalTitle,
          authorName: resolvedAuthorName,
          isbn13: normalizeValidIsbn(binding.isbn13?.value),
        };
      })
      .filter((term): term is WikidataCanonicalBookTerm => !!term);

    return uniqTerms(terms);
  }
}

export default WikidataAPI;
