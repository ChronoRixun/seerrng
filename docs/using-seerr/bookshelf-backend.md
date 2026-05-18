---
title: Bookshelf Backend
description: Deploy Bookshelf for ebook and audiobook requests.
sidebar_position: 21
---

# Bookshelf Backend

SeerrNG sends book requests to a Readarr-compatible Bookshelf API. For reliable
book requests, use Bookshelf's `softcover` image path with a Goodreads-compatible
metadata proxy. This keeps the existing Readarr-style database/API shape while
fixing lookup failures caused by incomplete Readarr metadata responses.

## Why Bookshelf

The legacy `lscr.io/linuxserver/readarr` backend can be reachable and still
return unusable `/api/v1/book/lookup` records. A bad lookup usually has a title
and a foreign book ID, but no author object and no editions. SeerrNG refuses to
add those raw records because Bookshelf/Readarr can reject them or create broken
library entries.

Bookshelf with `softcover` and `rreading-glasses` returns enough metadata for
SeerrNG to hydrate the missing author and edition fields before adding a book.

## Architecture

Run separate Bookshelf instances for ebooks and audiobooks:

- `bookshelf-ebooks` on port `8787`
- `bookshelf-audiobooks` on port `8788`
- `rreading-glasses` on port `8790`
- `rreading-glasses-postgres` on localhost-only port `15433`

Bookshelf supports only one type of a given book in a single instance. SeerrNG
therefore expects one default Bookshelf service for ebooks and a separate default
Bookshelf service for audiobooks when audiobook or both-format requests are used.

## Repository and Image

The public Snapetech fork is:

```text
https://github.com/snapetech/bookshelfng
```

The deployment compose defaults to the Snapetech image:

```text
ghcr.io/snapetech/bookshelfng:softcover
```

That image is built from the public `bookshelfng` fork and includes a lookup fix
so `/api/v1/book/lookup` returns nested `author` and `editions` data for
softcover results. To test against upstream Bookshelf instead, set
`BOOKSHELF_IMAGE=ghcr.io/pennydreadful/bookshelf:softcover`.

The image is published from GitHub Actions in the `snapetech/bookshelfng`
repository:

```bash
docker pull ghcr.io/snapetech/bookshelfng:softcover
```

If a pull returns `denied`, the package exists but is not anonymously readable.
Make it public in GitHub under **Packages > bookshelfng > Package settings >
Change visibility**, or authenticate Docker with a token that can read packages.
As a temporary fallback, set
`BOOKSHELF_IMAGE=ghcr.io/pennydreadful/bookshelf:softcover`; SeerrNG can hydrate
upstream softcover lookup results that contain `foreignEditionId` but return an
empty `editions` array.

## Known Good Versions

The validated SeerrNG backend migration build was:

```text
seerrng:bookshelf-fix-20260518f
```

The validated BookshelfNG fork includes these changes:

```text
bde894431 Return author and editions from book lookup
c416ad1af Add image publish workflow
d7dc505f8 Skip CI for documentation-only changes
```

Use `ghcr.io/snapetech/bookshelfng:softcover` for the fixed softcover image once
the GHCR package is public or the Docker host is authenticated. If you need a
fully anonymous pull before that package visibility is corrected, use
`ghcr.io/pennydreadful/bookshelf:softcover` and rely on SeerrNG's softcover
hydration fallback.

## Paths

Keep the same media and download mount paths that download clients and Plex
already know about. If these paths change, imports and hardlinks can break.

The example compose uses:

```text
/data      -> media root
/download  -> download root
/downloads -> media root compatibility mount
/plex      -> Plex library root
/media/plex -> Plex library root compatibility mount
```

For the validated deployment, the important in-container paths were:

```text
/data/plex/books
/download/books
```

## Installer Script

The repository includes an installer helper:

```bash
deploy/install-bookshelf-backend.sh
```

It does the following:

- validates Docker, Docker Compose, the compose template, and the Bookshelf
  image,
- copies `deploy/compose.bookshelf.yml` into an install directory,
- writes an `.env` file with a generated Postgres password,
- backs up existing Bookshelf/Readarr config directories,
- creates missing config/data directories,
- creates or patches each Bookshelf `config.xml` so the ebook instance binds
  port `8787` and the audiobook instance binds port `8788`,
- optionally stops an old Readarr container,
- starts Bookshelf, rreading-glasses, and Postgres with Docker Compose,
- prints the Seerr settings and validation commands.

Preview the install without changing files or containers:

```bash
sudo deploy/install-bookshelf-backend.sh --dry-run
```

Validate an already-rendered install directory without starting containers:

```bash
sudo deploy/install-bookshelf-backend.sh --validate-only
```

Validate the Bookshelf APIs after startup:

```bash
sudo EBOOK_API_KEY=replace-me AUDIOBOOK_API_KEY=replace-me \
  deploy/install-bookshelf-backend.sh --validate-api --skip-pull --no-stop-readarr
```

Run it on the Docker host:

```bash
sudo INSTALL_DIR=/opt/bookshelf-backend \
  BOOKSHELF_EBOOKS_CONFIG_DIR=/mnt/datapool_lvm_media/readarr-config \
  BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=/mnt/datapool_lvm_media/bookshelf-audiobooks-config \
  MEDIA_ROOT=/mnt/datapool_lvm_media \
  DOWNLOAD_ROOT=/mnt/datapool_lvm_media/download \
  PLEX_ROOT=/mnt/datapool_lvm_media/plex \
  deploy/install-bookshelf-backend.sh
```

To stop an existing Readarr container during migration:

```bash
sudo STOP_OLD_READARR_CONTAINER=readarr-host deploy/install-bookshelf-backend.sh
```

To keep an existing Readarr container running while preparing the new stack:

```bash
sudo STOP_OLD_READARR_CONTAINER=readarr-host \
  deploy/install-bookshelf-backend.sh --no-stop-readarr
```

To use the upstream image instead of the Snapetech fork:

```bash
sudo BOOKSHELF_IMAGE=ghcr.io/pennydreadful/bookshelf:softcover \
  deploy/install-bookshelf-backend.sh
```

If the image is already present locally or the registry requires authentication,
skip the pull step:

```bash
sudo deploy/install-bookshelf-backend.sh --skip-pull
```

## Manual Compose

Use the included compose file if you prefer manual setup:

```bash
mkdir -p /opt/bookshelf-backend
cp deploy/compose.bookshelf.yml /opt/bookshelf-backend/compose.yml
cd /opt/bookshelf-backend
```

Create `/opt/bookshelf-backend/.env`:

```env
PUID=1000
PGID=953
TZ=America/Regina

BOOKSHELF_IMAGE=ghcr.io/snapetech/bookshelfng:softcover
BOOKSHELF_METADATA_URL=http://127.0.0.1:8790
BOOKSHELF_EBOOKS_CONFIG_DIR=/mnt/datapool_lvm_media/readarr-config
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=/mnt/datapool_lvm_media/bookshelf-audiobooks-config

MEDIA_ROOT=/mnt/datapool_lvm_media
DOWNLOAD_ROOT=/mnt/datapool_lvm_media/download
PLEX_ROOT=/mnt/datapool_lvm_media/plex

RREADING_GLASSES_POSTGRES_DIR=/mnt/datapool_lvm_media/rreading-glasses-postgres/data
RREADING_GLASSES_POSTGRES_PASSWORD=replace-with-a-long-random-password
```

Start the stack:

```bash
docker compose pull
docker compose up -d
```

For a fresh manual setup, make sure each Bookshelf config directory has a
different port in `config.xml` before both containers run on host networking:

```xml
<!-- ebook config.xml -->
<Port>8787</Port>

<!-- audiobook config.xml -->
<Port>8788</Port>
```

If both instances bind `8787`, only one container can start successfully.

## Backups

Before replacing Readarr or moving config directories, back up:

- ebook Bookshelf/Readarr config directory,
- audiobook Bookshelf config directory, if it already exists,
- rreading-glasses Postgres data directory, if it already exists.

Example:

```bash
backup_dir=/mnt/datapool_lvm_media/backups/readarr-bookshelf-$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup_dir"
tar -C /mnt/datapool_lvm_media -czf "$backup_dir/readarr-config.tgz" readarr-config
tar -C /mnt/datapool_lvm_media -czf "$backup_dir/bookshelf-audiobooks-config.tgz" bookshelf-audiobooks-config
```

Do not delete the old backup after first boot. Keep it until ebook, audiobook,
and both-format requests have been tested through SeerrNG.

## SeerrNG Configuration

In **Settings > Services**, add two Bookshelf services.

Ebook service:

```text
Hostname: kspls0, 127.0.0.1, or the Docker host name reachable by SeerrNG
Port: 8787
Book Format: Ebook
Quality Profile: eBook
Root Folder: /data/plex/books
Default Server: enabled
Enable Scan: enabled
Enable Automatic Search: your policy
```

Audiobook service:

```text
Hostname: kspls0, 127.0.0.1, or the Docker host name reachable by SeerrNG
Port: 8788
Book Format: Audiobook
Quality Profile: Spoken
Root Folder: /data/plex/books, unless you maintain a separate audiobook root
Default Server: enabled
Enable Scan: enabled
Enable Automatic Search: your policy
```

Use each instance's own API key from **Bookshelf > Settings > General >
Security**. Do not reuse a stale key unless the config directory was intentionally
migrated and the key is still valid.

## Metadata Source

Each Bookshelf instance should use:

```text
http://127.0.0.1:8790
```

Verify with:

```bash
curl -H "X-Api-Key: EBOOK_API_KEY" \
  http://127.0.0.1:8787/api/v1/config/development

curl -H "X-Api-Key: AUDIOBOOK_API_KEY" \
  http://127.0.0.1:8788/api/v1/config/development
```

Both responses should include:

```json
{
  "metadataSource": "http://127.0.0.1:8790"
}
```

## Lookup Validation

Run these against the Docker host:

```bash
curl -H "X-Api-Key: EBOOK_API_KEY" \
  "http://127.0.0.1:8787/api/v1/book/lookup?term=isbn:9780547928227"

curl -H "X-Api-Key: AUDIOBOOK_API_KEY" \
  "http://127.0.0.1:8788/api/v1/book/lookup?term=Foundation%20Isaac%20Asimov"

curl -H "X-Api-Key: EBOOK_API_KEY" \
  "http://127.0.0.1:8787/api/v1/author/lookup?term=J.R.R.%20Tolkien"
```

With `ghcr.io/snapetech/bookshelfng:softcover`, lookup results should include
nested `author` metadata and at least one `editions` entry. If you use upstream
Bookshelf and see `editions: []`, SeerrNG can still hydrate results that include
`foreignEditionId` and resolvable author metadata, but the Snapetech image is
the recommended fix.

## SeerrNG Diagnostic

The Bookshelf settings modal includes **Run Diagnostic**. It checks:

- backend unreachable,
- lookup returned no results,
- lookup returned incomplete/unusable results,
- backend rejected an add test,
- lookup is usable.

The API endpoint is:

```http
POST /api/v1/settings/readarr/diagnose
```

With a valid authenticated admin session, the body is the same Bookshelf settings
shape used by the service modal. Add `"testAdd": true` when you want SeerrNG to
attempt an add and immediately remove the test book without deleting files.

## Request Validation

After configuring both services:

1. Request an ebook for a known addable book.
2. Request an audiobook for a known addable book.
3. Request both formats for a known addable book.
4. Confirm the ebook request lands in `bookshelf-ebooks`.
5. Confirm the audiobook request lands in `bookshelf-audiobooks`.
6. Confirm each item uses the expected root folder and quality profile.
7. Confirm SeerrNG marks the request `COMPLETED`.

## Rollback

If the migration fails:

1. Stop the Bookshelf stack:

   ```bash
   cd /opt/bookshelf-backend
   docker compose down
   ```

2. Restore the backed-up ebook config directory:

   ```bash
   rm -rf /mnt/datapool_lvm_media/readarr-config
   tar -C /mnt/datapool_lvm_media -xzf /path/to/readarr-config.tgz
   ```

3. Restore the audiobook config directory if it was changed:

   ```bash
   rm -rf /mnt/datapool_lvm_media/bookshelf-audiobooks-config
   tar -C /mnt/datapool_lvm_media -xzf /path/to/bookshelf-audiobooks-config.tgz
   ```

4. Restore rreading-glasses Postgres data if you need to preserve its cache:

   ```bash
   rm -rf /mnt/datapool_lvm_media/rreading-glasses-postgres/data
   tar -C /mnt/datapool_lvm_media/rreading-glasses-postgres \
     -xzf /path/to/rreading-glasses-postgres.tgz
   ```

5. Start the old Readarr container with the original mounts.
6. In SeerrNG, point the ebook service back to the old Readarr endpoint or
   disable book requests until Bookshelf is corrected.

Rollback does not require changing SeerrNG code. It only changes service
settings and backend containers.

## Troubleshooting

`backend_unreachable`:

- confirm the container is running,
- confirm SeerrNG can reach the host and port,
- confirm the API key is correct,
- confirm URL Base is empty unless Bookshelf is configured with one.

`lookup_empty`:

- confirm rreading-glasses is running,
- confirm Bookshelf `metadataSource` is `http://127.0.0.1:8790`,
- try an ISBN lookup such as `isbn:9780547928227`.

`lookup_incomplete`:

- confirm `/api/v1/author/lookup` works for the author,
- confirm the lookup result has `foreignEditionId`,
- update SeerrNG to a build that includes Bookshelf softcover hydration.

`backend_add_rejected`:

- check Bookshelf logs,
- confirm root folder and quality profile exist in that Bookshelf instance,
- confirm the selected root folder is writable inside the container,
- confirm download client paths match the container mounts.

Bulk request returns `serverId must be a positive integer`:

- update SeerrNG to a build that accepts zero-valued Servarr IDs in request
  overrides,
- confirm the service still exists in **Settings > Services**,
- retry the request after reloading the browser.

This can affect the first configured Bookshelf or Lidarr service because SeerrNG
stores service IDs starting at `0`. The backend must treat `0` as a valid
service/profile override value, not as a missing or invalid ID.

## Current Limitations

- Bulk book and music requests can still take a long time on large discographies
  or bibliographies. The modal shows submit progress and can retry failed items,
  but it does not yet offer a per-item backend preflight before submission.
- Music discography selection defaults to albums and can be filtered by release
  type. Review the selection before requesting singles, live albums,
  compilations, or other secondary release groups.
- Book requests rely on Bookshelf-compatible lookup metadata. The diagnostic
  can identify incomplete lookup results, but it does not yet run automatically
  before every request.
- Both-format book requests dispatch to two backend services. Check each
  Bookshelf instance when troubleshooting partial success.
