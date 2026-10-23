# Local releases

Run releases on **main**, locally, with Node.js **24.15 or newer** and the existing Git SSH login for `origin`. There is no release workflow in CI or Coolify and no npm package publication. Coolify builds the version already recorded in Git.

Review and stage the intended files explicitly, then run one command instead of a manual commit/push:

```sh
git add path/to/reviewed-file.ts path/to/another-file.ts
npm run release -- "feat(lobby): describe the change"
```

The command checks for a full clone, the main branch, a worktree containing only staged changes, current remote history and push permission. It runs `npm run check`, records the local Conventional Commit, and starts **semantic-release** with local mode enabled. The release plugins then:

1. Analyze all commits since the latest `vX.Y.Z` tag.
2. Update `package.json`, both root version entries in `package-lock.json`, and `CHANGELOG.md`.
3. Build the application using the new version.
4. Create `chore(release): X.Y.Z [skip ci]`, push main and publish the `vX.Y.Z` tag.

The preliminary local commit is necessary: semantic-release analyzes commits, not staged diffs. Version preparation happens before the final release commit and push. The command never stages unrelated files or rewrites Git history. A failed check leaves staged changes untouched. A later failure retains the local commit/files for inspection; it never automatically resets or force-pushes.

## Version rules

- `feat:` → minor.
- `fix:`, `perf:`, `refactor:`, `docs:`, `build:`, `ci:`, `test:`, `style:`, `chore:` and `revert:` → patch.
- `!` after the type/scope, or a `BREAKING CHANGE:` footer → major.
- With no previous semantic version tag, semantic-release starts at **1.0.0**, including the earlier untagged history in the changelog. Subsequent calls without new commits do not create another version.

The release commit is tagged, so it is not included again in the next version's commit range. `chore(release)` is reserved for the release tool. Keep messages descriptive: they become the changelog entries.

## Existing commits and previews

To release already recorded local commits, or resume after a failure that occurred before publication, inspect the local and remote state and run the command without a new message:

```sh
npm run release
```

For a read-only version/notes preview from an otherwise clean tree:

```sh
npm run release:preview
```

Preview analyzes **existing commits only**, performs no commit, version update or push, and still verifies push permission. If a network error interrupts publication, first check whether the release commit and tag already reached origin. Do not rerun blindly or delete a remote tag. Correct the actual incomplete step without changing published history.

## Display and deployment

The menu footer displays `vX.Y.Z` and links to this repository's changelog. `/api/health` reports the same version. Both read `package.json` through `shared/version.ts`; there is no second version constant to maintain. The prepare step rebuilds ignored output with the updated version. Deployment is a separate operation requiring a deployment request; it preserves the existing data volume.

Configuration: `.releaserc.json`. Implementation: `scripts/release.ts`. Authentication uses the repository's normal Git credentials; no npm token or GitHub API token is needed for this tag-and-changelog workflow.

Sources: [semantic-release local mode and dry-run](https://semantic-release.gitbook.io/semantic-release/usage/configuration), [npm version preparation](https://github.com/semantic-release/npm), [release commits](https://github.com/semantic-release/git).
