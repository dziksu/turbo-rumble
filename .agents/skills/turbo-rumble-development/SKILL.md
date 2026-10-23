---
name: turbo-rumble-development
description: Develop or review Turbo Rumble gameplay, TypeScript client/server code, phone controllers, multiplayer regression tests and local versioned commit/push workflows. Use within the Turbo Rumble project.
---

# Turbo Rumble development

Find the repository by its `package.json` name `turbo-rumble`; on Benjamin's Mac it is `/Users/benjaminrast/projects/turbo-rumble`. Read its `AGENTS.md` and `docs/ARCHITEKTURA.md` before changing ownership between modules.

## Choose the owning module

- Driving/grip/drift: `shared/driving.ts`; authority and phase transitions: `shared/simulation.ts`.
- Trailing-car assistance: `shared/catch-up.ts`. It adjusts target speed only; it never steers, consumes an item, sets the nitro flag or stacks with nitro. Preserve its fade and suppression during braking, frost, impacts, air and wrong-way driving.
- Weapons, swept hits and explosion impulses: `shared/weapons.ts`; public state/entities: `shared/types.ts` / `shared/entities.ts`.
- New wire events: `shared/protocol.ts`, then `server/realtime.ts` and the consuming page. TypeScript types do not validate packets at runtime.
- Rooms/permissions: `server/rooms.ts`; HTTP: `server/http.ts`; tick and persistence scheduling: `server/runtime.ts`.
- Visible road edges/curbs/guardrails: `client/track-visuals.ts`; collision geometry stays in `shared/track.ts`. Use dev-only `/map-check` for fixed before/after camera views and avoid coplanar overlapping box surfaces.
- Host/phone UI: `client/pages/`; input transport: `client/core/network.ts`; rendering: `client/scene.ts`; transient effects: `client/race-effects.ts`.

## Preserve the non-obvious behavior

- Server owns Rapier at 50 Hz; clients send only buttons and monotonic sequence counters. Snapshot cadence is 25 Hz. Reconnect resets counters; an older controller socket must not control the same car.
- Humans have automatic throttle and entirely manual heading. Only bots track the racing line. With +Z forward, positive Y yaw is a left turn in the chase view. Projectiles follow the car nose, not the track tangent.
- Both steering buttons brake. Drift, grounded checks, explosion impulses and wreck lifetime must remain physical; avoid snapping cars to the track.
- During segment/finished/paused phases, racing standings are hidden. Round deltas and final results have separate layouts. Test long 18-character names and eight players when changing score UI.
- GLTF clones share GPU resources. `disposeResources` must retain source models when removing an individual car. Full scene teardown owns all remaining assets.

## Verify the changed behavior

Run `npm run check` and `npm run build`. For multiplayer changes, run an isolated server with temporary `DATA_DIR`, then `GAME_URL=http://localhost:<port> npm run smoke` or `npm run playtest`. Never point destructive QA at a room people are currently playing. Use meaningful regression tests in `tests/`; existing physics tests cover steering orientation, manual heading, ramps, all weapons and scoring.

Use the available browser tool to verify visible UI changes in a real host and phone viewport. Dev-only `/handling-check` and `/audio-check` help reproduce effects. They are excluded from production routing. Record what was actually exercised, including limitations; do not call a network bot script a real-device test.

## Local versioned commits and pushes

When the user requests **commit and push** for Turbo Rumble, use the repository's local release command instead of making a plain commit/push. Read `docs/RELEASING.md`, review the scope, and stage explicit paths. Run `npm run release -- "feat(scope): describe the change"` (or the appropriate Conventional Commit type). The command runs checks, creates the preliminary local commit required by semantic-release, updates package/lock/changelog, builds with the new version, creates the release commit and pushes main plus its version tag. Run it before any manual final commit/push; do not duplicate its commits. For already recorded local commits, inspect state and use `npm run release` without a message. Do not invoke it for a commit-only request, from CI/Coolify, or without push authorization. On failure, inspect local/remote state before retrying; preserve published tags and never force-push. Deployment remains separately authorized.

## Local versioned commits and pushes

When the user requests **commit and push** for Turbo Rumble, use the repository's local release command instead of making a plain commit/push. Read `docs/RELEASING.md`, review the scope, and stage explicit paths. Run `npm run release -- "feat(scope): describe the change"` (or the appropriate Conventional Commit type). The command runs checks, creates the preliminary local commit required by semantic-release, updates package/lock/changelog, builds with the new version, creates the release commit and pushes main plus its version tag. Run it before any manual final commit/push; do not duplicate its commits. For already recorded local commits, inspect state and use `npm run release` without a message. Do not invoke it for a commit-only request, from CI/Coolify, or without push authorization. On failure, inspect local/remote state before retrying; preserve published tags and never force-push. Deployment remains separately authorized.
