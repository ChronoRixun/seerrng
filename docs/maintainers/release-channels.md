# Release Channels

Release publishing is coordinated by `.github/workflows/release.yml` after a `v*`
tag is published. Package workflows are dispatch-only so a tag release does not
double-publish.

## Snapcraft Credentials

The Snap workflow requires the repository secret
`SNAPCRAFT_STORE_CREDENTIALS`. The Snap account ID is not a publish token;
Snapcraft publishing uses exported Ubuntu One/Snap Store login credentials.
The current exported credential is also stored in OpenBao at
`secret/seerrng/snapcraft` under `store_credentials`.

Generate a `seerrng`-scoped credential with:

```bash
/snap/bin/snapcraft export-login --snaps seerrng --acls package_upload,package_release --expires 2026-06-13T00:00:00Z - | gh secret set SNAPCRAFT_STORE_CREDENTIALS --repo snapetech/seerrng
```

Do not write exported Snapcraft credentials into tracked files.
