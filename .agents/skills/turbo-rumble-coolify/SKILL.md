---
name: turbo-rumble-coolify
description: Prepare, verify or operate the Turbo Rumble Docker application on Coolify, including health checks, persistent SQLite results, backups and rollback.
---

# Turbo Rumble on Coolify

Locate the `turbo-rumble` repository and read `docs/COOLIFY.md` for the current exact settings. Default local path: `/Users/benjaminrast/projects/turbo-rumble`.

## Verify before release

Use `Dockerfile` as the Coolify build pack, repository root as context, and internal port 4317. The multi-stage image runs Node 24 as UID/GID 1000; it contains built assets and production dependencies. Local `compose.yaml` is a rehearsal, not the Coolify production resource definition.

- `DATA_DIR=/app/data` requires a persistent volume at `/app/data` writable by UID 1000. Never replace it with a temporary container filesystem or copy a local developer database into the image.
- Set `PUBLIC_URL` to the actual HTTPS origin; verify that QR opens that origin on a phone. No credentials, subpath or query string in this value.
- Set `TRUST_PROXY_HOPS=1` only when the app is reached through exactly one trusted proxy. Additional CDN/proxy hops need an explicit topology decision, not blind trust of all forwarding headers.
- The image defines a Node-based Docker HEALTHCHECK against `/api/health`; no curl is installed. Coolify can use this image check. If choosing a separate HTTP check, follow Coolify's current curl/wget requirements.
- Keep one replica. Rooms, timers and Rapier worlds live in memory; SQLite persists completed results only. Redeploy/restart ends active rooms. Schedule releases between games; rolling deployment does not preserve matches.

Run `npm run check`, `npm run build`, then build and run the image against a new test volume. Exercise HTTP, real Socket.IO controllers, completed-match persistence across container recreation, backup integrity, health status and SIGTERM exit. Keep the user's development server running; clean up only test containers/volumes created for this verification.

## Backup and rollback

Use `node dist-server/backup.js /app/data/backups/<unique-name>.sqlite` inside the running container. The script uses SQLite's online backup API and verifies integrity. Copy the completed backup off-host. A persistent volume is not a backup. Restore only while the application is stopped and follow `docs/COOLIFY.md` to keep WAL/SHM consistent.

Preparing files or reviewing settings does not authorize a production release. When release is requested, resolve the target resource/domain and database volume before changing external state. Preserve the previous image/revision for rollback, retain the data volume, and report that active rooms will be lost if a restart is necessary.
