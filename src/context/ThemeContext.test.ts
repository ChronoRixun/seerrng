import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { themePalettes } from './ThemeContext';

describe('themePalettes', () => {
  it('includes the Sietch palette displayed by the theme picker', () => {
    assert.deepEqual(
      themePalettes.map((palette) => palette.id).slice(-3),
      ['violet', 'ocean', 'sietch-neon']
    );

    assert.equal(
      themePalettes.find((palette) => palette.id === 'sietch-neon')?.name,
      'Sietch'
    );
  });
});
