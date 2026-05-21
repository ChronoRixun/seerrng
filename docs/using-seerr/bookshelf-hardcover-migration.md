---
title: Bookshelf Hardcover Migration
description: Migrate existing Readarr or softcover Bookshelf libraries to Hardcover-backed Bookshelf.
sidebar_position: 22
---

# Bookshelf Hardcover Migration

SeerrNG can migrate an existing Readarr-compatible ebook/audiobook library into
Bookshelf instances backed by Hardcover metadata. The migration is layered and
resumable: it keeps strict Hardcover matches, retries transient failures, uses a
softcover Bookshelf endpoint to recover metadata when Hardcover rejects a stale
ID, and can optionally create deterministic local Bookshelf rows for the few
books that Hardcover still cannot import.

The validated lab result imported `2115 / 2115` books with `0` failures. In that
run, most books imported through the normal Hardcover API path. The final `42`
records required the explicit `HARDCOVER_LOCAL_DB_IMPORT=true` fallback because
Hardcover metadata rejected every API-safe candidate.

## What "100%" Means

The migration can reach 100% of the source inventory in a Bookshelf Hardcover
target when the final local DB fallback is enabled.

That does not mean every source book has a native Hardcover ID. Records imported
by the local DB fallback use stable IDs like:

```text
local:ebook:1076
local:audiobook:4905
```

Those records are visible through the Bookshelf API and are included in
validation/cutover checks, but they are not Hardcover metadata records. They are
the deterministic last-resort layer for users who want their library represented
without requiring an LLM or manual data cleanup.

## Compatibility Layers

The migration keeps earlier recovery layers. It does not replace them.

1. Source inventory is exported from Readarr/Bookshelf SQLite.
2. Existing Hardcover matches are reused when strict enough.
3. ISBN/ASIN/title/author lookup variants are tried against Hardcover.
4. Apply resumes from `applied-books.json` and skips already imported records.
5. Target cache duplicate rows are de-duplicated when they cause API errors.
6. Missing target authors are pre-created when Hardcover can resolve them.
7. Alternate Hardcover candidates are tried when the first target ID is bad.
8. Optional softcover fallback recovers title/author/edition metadata from a
   softcover Bookshelf endpoint, then remaps back through Hardcover.
9. Optional local DB fallback inserts deterministic local records for anything
   still rejected by the target API.

The local DB fallback is opt-in. Leave it off when you only want native
Hardcover-backed books.

## Required Inputs

You need one source config directory for ebooks and, if used, one for
audiobooks:

```text
BOOKSHELF_EBOOKS_CONFIG_DIR=/path/to/readarr-or-bookshelf-ebook-config
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=/path/to/readarr-or-bookshelf-audiobook-config
```

You also need running Hardcover target Bookshelf instances and their API keys:

```text
HARDCOVER_EBOOK_BASE_URL=http://127.0.0.1:8787
HARDCOVER_AUDIOBOOK_BASE_URL=http://127.0.0.1:8788
HARDCOVER_EBOOK_API_KEY=...
HARDCOVER_AUDIOBOOK_API_KEY=...
```

If you want the softcover recovery layer, run or keep a softcover Bookshelf pair
available and provide:

```text
HARDCOVER_SOFTCOVER_EBOOK_BASE_URL=http://127.0.0.1:18887
HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL=http://127.0.0.1:18888
HARDCOVER_SOFTCOVER_EBOOK_API_KEY=...
HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY=...
```

## Report-Only Run

Generate inventory, match reports, and rebuild payloads without importing:

```bash
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

Review these files in the generated `hardcover-migration` directory:

```text
ebook-inventory.json
audiobook-inventory.json
matched-books.json
unmatched-books.json
ambiguous-books.json
rebuild-payload.json
rebuild-blocked.json
migration-report.json
```

## Apply Run

Apply matched/recovered books to prepared Hardcover targets:

```bash
APPLY_HARDCOVER_REBUILD=true \
HARDCOVER_EBOOK_API_KEY=... \
HARDCOVER_AUDIOBOOK_API_KEY=... \
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

The apply phase writes:

```text
applied-books.json
apply-failures.json
apply-failure-summary.json
validation-report.json
cutover-decision.json
lookup-cache.json
ebook-match-checkpoint.json
audiobook-match-checkpoint.json
```

If the process stops, rerun the same command. Previously applied source records
are skipped.

## 100% Fallback Run

Enable the final fallback only after reviewing failures and deciding that local
records are acceptable for non-Hardcover metadata gaps:

```bash
APPLY_HARDCOVER_REBUILD=true \
HARDCOVER_LOCAL_DB_IMPORT=true \
HARDCOVER_EBOOK_CONFIG_DIR=/path/to/hardcover-ebook-config \
HARDCOVER_AUDIOBOOK_CONFIG_DIR=/path/to/hardcover-audiobook-config \
HARDCOVER_EBOOK_API_KEY=... \
HARDCOVER_AUDIOBOOK_API_KEY=... \
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

`HARDCOVER_LOCAL_DB_IMPORT=true` requires `sqlite3` and direct access to the
target `readarr.db` files. It inserts only after the API path and softcover
recovery path fail.

## Useful Tuning

```env
HARDCOVER_API_TIMEOUT_MS=30000
HARDCOVER_RATE_LIMIT_BATCH_SIZE=20
HARDCOVER_RATE_LIMIT_DELAY_MS=3000
HARDCOVER_RATE_LIMIT_MAX_RETRIES=1
HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS=5000
HARDCOVER_RECOVERY_LOOKUP_LIMIT=4
HARDCOVER_MATCH_CONCURRENCY=6
HARDCOVER_CHECKPOINT_INTERVAL=1
HARDCOVER_DEDUPE_TARGET_CACHE=true
HARDCOVER_IDENTIFIER_FALLBACK=false
HARDCOVER_VALIDATION_LOOKUP_RETRIES=3
HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS=10000
```

## Validation and Cutover

Validate an already-applied migration:

```bash
node deploy/bookshelf-hardcover-migration.mjs --validate \
  /opt/bookshelf-backend/backups/20260520-082024/hardcover-migration
```

Check cutover readiness:

```bash
node deploy/bookshelf-hardcover-migration.mjs --cutover-check \
  /opt/bookshelf-backend/backups/20260520-082024/hardcover-migration
```

A successful cutover decision looks like:

```json
{
  "ok": true,
  "reasons": [],
  "status": "validation_complete",
  "applyCounts": {
    "applied": 2115,
    "failed": 0
  }
}
```

## Lab Rehearsal

Use the lab script for a disposable trial:

```bash
SOURCE_EBOOK_CONFIG_DIR=/path/to/source/ebook \
SOURCE_AUDIOBOOK_CONFIG_DIR=/path/to/source/audiobook \
deploy/bookshelf-migration-lab.sh apply
```

To rehearse the 100% final fallback:

```bash
HARDCOVER_LOCAL_DB_IMPORT=true \
SOURCE_EBOOK_CONFIG_DIR=/path/to/source/ebook \
SOURCE_AUDIOBOOK_CONFIG_DIR=/path/to/source/audiobook \
deploy/bookshelf-migration-lab.sh apply
```

The lab uses ports `18787` and `18788` for the target Hardcover instances.

## Rollback

The installer writes timestamped backups before mutation. If validation fails,
restore from `BACKUP_DIR`:

```bash
BACKUP_DIR=/opt/bookshelf-backend/backups/20260520-082024 \
deploy/install-bookshelf-backend.sh --restore-backup
```

Keep the old Readarr/softcover data until ebook, audiobook, and both-format
requests have been tested through SeerrNG.
