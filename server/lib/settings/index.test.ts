import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertSettingsFileSize, MAX_SETTINGS_FILE_BYTES } from '.';

describe('assertSettingsFileSize', () => {
  it('allows settings files within the byte limit', () => {
    assert.doesNotThrow(() => assertSettingsFileSize(MAX_SETTINGS_FILE_BYTES));
  });

  it('rejects oversized settings files before reading them', () => {
    assert.throws(
      () => assertSettingsFileSize(MAX_SETTINGS_FILE_BYTES + 1),
      /settings file exceeds maximum size/i
    );
  });

  it('rejects invalid stat sizes', () => {
    assert.throws(() => assertSettingsFileSize(Number.NaN), /settings file/i);
    assert.throws(() => assertSettingsFileSize(-1), /settings file/i);
  });
});
