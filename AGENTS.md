# Turbo Rumble

This is the standalone party-racing game. Do not edit Rachel or sibling projects.

Read `docs/ARCHITEKTURA.md` for module ownership and `docs/COOLIFY.md` for container operations. App code, tests and scripts are TypeScript with strict compilation; `eslint.config.mjs` is tooling configuration.

Project skills:

- `.agents/skills/turbo-rumble-development/SKILL.md`: gameplay, review, typed protocol, UI and multiplayer verification.
- `.agents/skills/turbo-rumble-coolify/SKILL.md`: container verification, persistent SQLite, backup and Coolify deployment.

Use relevant available MCP tools before generic alternatives. Prefix terminal commands with `rtk` when installed (`rtk proxy` for unsupported commands); ordinary npm commands below also work outside Codex.

## Work and checks

User-facing interfaces default to English. Reuse the shared language selection, saved preference, translations and locale formatting in `client/i18n.ts` on every page; never force a page to Polish. Polish is an explicit user choice.

Node 24 (`.nvmrc`), `npm ci`, `npm run dev` on port 4317. `npm run check` covers TypeScript, ESLint, formatting and tests. `npm run build` produces the browser bundle and server/backup entrypoints. Do not skip a failed check with suppressions; fix the cause or report an actual environment limitation.

For isolated integration QA, use a free `PORT` and temporary `DATA_DIR`; set `GAME_URL` for `npm run smoke` / `npm run playtest`. These scripts create rooms and drive eight network controllers. Never reuse an active user room without explicit intent. Keep the final development preview running and remove only temporary servers/containers you created.

## Invariants

- Server-authoritative 50 Hz Rapier; 25 Hz snapshots. Validate untrusted payloads at the boundary in `shared/protocol.ts`.
- Human heading is manual, with auto throttle; racing-line assistance is bot-only. +Z forward / +Y yaw turns left in chase view. Both buttons brake.
- Monotonic input/action counters, one active socket per controller, host-only room commands.
- Separate score UI for racing, round summary and final results; preserve eight-player and narrow-screen layouts.
- Free owned GPU/WASM resources; never dispose a shared GLTF material while another car uses it.
- One runtime replica. Rooms are in memory; only completed results persist in SQLite. `/app/data` must remain a volume in production. Never erase or overwrite real `data/` during refactors or QA.

Do not deploy, push, change global services or overwrite a database merely because you prepared deployment files. Keep changes within the user's requested scope. Historical QA reports under `docs/qa/` describe earlier revisions and are not current verification evidence.

## Maps and room rules

Map definitions live in `shared/maps.ts`; use `race.track` / `scene.track` for map-specific geometry. Named exports from `shared/track.ts` are desert-only compatibility fixtures, never global mutable state. Client biomes live in `client/biomes.ts`; real holes, ramps and lava/river elimination are server-authoritative. Room setup lives in `client/room-settings.ts` and `server/rooms.ts`. The first human is admin; only their current authenticated controller can configure rules. Preserve automatic 5-second starts, cancellation on unready/disconnect/new join, and readiness reset after rule changes. Use `QA_MAP=forest|volcano` for isolated network playtests.
