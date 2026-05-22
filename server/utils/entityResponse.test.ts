import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { filterEntityResponse } from './entityResponse';

describe('filterEntityResponse', () => {
  it('canonicalizes nested music and book identifiers at the response boundary', () => {
    const response = filterEntityResponse({
      mediaType: MediaType.MUSIC,
      externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
      externalId: ' 550E8400-E29B-41D4-A716-446655440000 ',
      mbId: ' 550E8400-E29B-41D4-A716-446655440001 ',
      identifiers: [
        {
          provider: MediaIdentifierProvider.MUSICBRAINZ,
          value: ' 550E8400-E29B-41D4-A716-446655440002 ',
        },
        {
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: '/works/OL123W',
        },
      ],
      book: {
        mediaType: MediaType.BOOK,
        externalProvider: MediaIdentifierProvider.OPENLIBRARY,
        externalId: '/works/OL456W',
      },
    });

    assert.equal(response.externalId, '550e8400-e29b-41d4-a716-446655440000');
    assert.equal(response.mbId, '550e8400-e29b-41d4-a716-446655440001');
    assert.equal(
      response.identifiers[0].value,
      '550e8400-e29b-41d4-a716-446655440002'
    );
    assert.equal(response.identifiers[1].value, 'OL123W');
    assert.equal(response.book.externalId, 'OL456W');
  });
});
