import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';

import {
  assertMappingFileSize,
  createSizeLimitTransform,
  MAX_MAPPING_FILE_BYTES,
} from './animelist';

const readLimitedStream = async (chunks: Buffer[], maxBytes: number) => {
  const output: Buffer[] = [];
  await pipeline(
    Readable.from(chunks),
    createSizeLimitTransform(maxBytes),
    new Writable({
      write(chunk, _encoding, callback) {
        output.push(Buffer.from(chunk));
        callback();
      },
    })
  );

  return Buffer.concat(output);
};

describe('createSizeLimitTransform', () => {
  it('passes downloads within the byte limit', async () => {
    const result = await readLimitedStream(
      [Buffer.from('anime'), Buffer.from('-list')],
      10
    );

    assert.equal(result.toString(), 'anime-list');
  });

  it('rejects downloads that exceed the byte limit', async () => {
    await assert.rejects(
      readLimitedStream([Buffer.from('anime'), Buffer.from('-list')], 9),
      /download exceeds maximum size/
    );
  });
});

describe('assertMappingFileSize', () => {
  it('allows local mapping files within the byte limit', () => {
    assert.doesNotThrow(() => assertMappingFileSize(MAX_MAPPING_FILE_BYTES));
  });

  it('rejects oversized local mapping files before reading them', () => {
    assert.throws(
      () => assertMappingFileSize(MAX_MAPPING_FILE_BYTES + 1),
      /mapping file exceeds maximum size/
    );
  });
});
