import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semanticRelease from 'semantic-release';

/** Releases only reviewed, explicitly staged files. Never stages the whole worktree. */
export async function release(message?: string, dryRun = false, cwd = process.cwd()) {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { cwd, stdio: 'inherit' });
  const enabled = (value: string | undefined) =>
    Boolean(value && value !== 'false' && value !== '0');
  if (
    ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'JENKINS_URL'].some((key) =>
      enabled(process.env[key]),
    )
  )
    throw new Error(
      'Releases run locally. Do not invoke this command from CI or a deployment build.',
    );
  if (git('rev-parse', '--is-shallow-repository') === 'true')
    throw new Error('A release needs the full Git history and tags; use a full clone.');
  if (git('branch', '--show-current') !== 'main')
    throw new Error('Release from main after integrating the reviewed changes.');
  if (git('diff', '--name-only') || git('ls-files', '--others', '--exclude-standard'))
    throw new Error(
      'Unstaged or untracked files remain. Stage only reviewed changes before releasing.',
    );
  const staged = Boolean(git('diff', '--cached', '--name-only'));
  if (dryRun && (staged || message))
    throw new Error(
      'The preview analyzes existing commits only; it does not commit staged changes.',
    );
  if (staged && !message)
    throw new Error(
      'Supply a Conventional Commit message: npm run release -- "feat: describe the change"',
    );
  if (message && !staged)
    throw new Error('No staged changes to commit. To retry an existing commit, omit the message.');
  if (
    message &&
    !/^(feat|fix|perf|refactor|docs|build|ci|test|style|chore|revert)(\([^\r\n)]+\))?!?: [^\r\n]+(?:\r?\n[\s\S]*)?$/.test(
      message,
    )
  )
    throw new Error('Use a Conventional Commit, e.g. fix(lobby): correct the track thumbnail.');
  if (message?.startsWith('chore(release):'))
    throw new Error('The chore(release) scope is reserved for semantic-release.');

  const repositoryUrl = git('remote', 'get-url', 'origin');
  run('git', ['fetch', 'origin', '--tags']);
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], {
    cwd,
  });
  if (ancestor.status !== 0)
    throw new Error(
      'main is behind or diverged from origin/main. Integrate the remote changes first.',
    );
  run('git', ['push', '--dry-run', 'origin', 'HEAD:refs/heads/main']);

  if (dryRun) return semanticRelease({ noCi: true, dryRun: true, repositoryUrl }, { cwd });
  run('git', ['diff', '--cached', '--check']);
  run('npm', ['run', 'check']);
  if (message) run('git', ['commit', '-m', message]);

  // The plugins update version/lock/changelog, build with that version, then commit them.
  // semantic-release pushes the release commit and vX.Y.Z tag using the existing Git SSH login.
  const result = await semanticRelease({ noCi: true, repositoryUrl }, { cwd });
  // Also complete the requested push when there are no new commits to release.
  run('git', ['push', 'origin', 'HEAD:refs/heads/main']);
  console.log(
    result ? `Released ${result.nextRelease.gitTag}.` : 'No new version; main is up to date.',
  );
  return result;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    dryRun = args.includes('--dry-run');
  const messages = args.filter((arg) => arg !== '--dry-run');
  if (messages.length > 1) {
    console.error(
      'Usage: npm run release -- "feat: describe the change" (or npm run release:preview)',
    );
    process.exitCode = 1;
  } else {
    release(messages[0], dryRun).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      console.error(
        'Release stopped. Local changes/commits are retained. Inspect Git status and remote tags before retrying; do not force-push or recreate a published tag.',
      );
      process.exitCode = 1;
    });
  }
}
