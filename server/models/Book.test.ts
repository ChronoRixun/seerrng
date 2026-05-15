import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapOpenLibraryWork } from '@server/models/Book';

describe('mapOpenLibraryWork', () => {
  it('extracts and ranks unique ISBN candidates from editions', () => {
    const result = mapOpenLibraryWork(
      {
        key: '/works/OL123W',
        title: 'Test Book',
      },
      undefined,
      [
        {
          key: '/books/OL1M',
          title: 'Paperback',
          isbn_10: ['0-123-45678-X'],
          physical_format: 'Paperback',
        },
        {
          key: '/books/OL2M',
          title: 'Hardcover',
          isbn_13: ['978-0-123-45678-9'],
          physical_format: 'Hardcover',
        },
        {
          key: '/books/OL3M',
          title: 'Duplicate',
          isbn_13: ['9780123456789'],
        },
      ]
    );

    assert.strictEqual(result.isbn13, '9780123456789');
    assert.strictEqual(result.editionId, 'OL2M');
    assert.deepStrictEqual(
      result.isbnCandidates?.map((candidate) => candidate.isbn),
      ['9780123456789', '012345678X']
    );
  });
});
