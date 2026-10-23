import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = resolve(root, 'scripts/release.ts');
const configuration = readFileSync(resolve(root, '.releaserc.json'), 'utf8');
const versionModule = readFileSync(resolve(root, 'shared/version.ts'), 'utf8');

function fixture({ checkFails = false, buildFails = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'turbo-release-'));
  const cwd = join(base, 'work'),
    remote = join(base, 'origin.git');
  mkdirSync(cwd);
  const env = {
    ...process.env,
    CI: '',
    GITHUB_ACTIONS: '',
    GITLAB_CI: '',
    TF_BUILD: '',
    JENKINS_URL: '',
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { env, stdio: 'pipe' });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Release QA');
  git('config', 'user.email', 'release-qa@example.invalid');
  git('remote', 'add', 'origin', pathToFileURL(remote).href);
  symlinkSync(resolve(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
  writeFileSync(join(cwd, '.gitignore'), 'node_modules\ndist/\n');
  writeFileSync(join(cwd, '.releaserc.json'), configuration);
  writeFileSync(join(cwd, 'CHANGELOG.md'), '# Changelog\n');
  const pkg = {
    name: 'release-fixture',
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      check: `node -e "process.exit(${checkFails ? 1 : 0})"`,
      'release:prepare': 'node build.mjs',
    },
  };
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(
    join(cwd, 'package-lock.json'),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: pkg.name, version: pkg.version } },
      },
      null,
      2,
    ) + '\n',
  );
  mkdirSync(join(cwd, 'shared'));
  writeFileSync(join(cwd, 'shared/version.ts'), versionModule);
  writeFileSync(
    join(cwd, 'build.mjs'),
    `import { GAME_VERSION } from './shared/version.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
${buildFails ? 'process.exit(1);' : "mkdirSync('dist', {recursive:true});writeFileSync('dist/version.txt', GAME_VERSION);"}\n`,
  );
  git(
    'add',
    '.gitignore',
    '.releaserc.json',
    'CHANGELOG.md',
    'package.json',
    'package-lock.json',
    'shared/version.ts',
    'build.mjs',
  );
  git('commit', '-m', 'chore: initialize release fixture');
  git('push', '-u', 'origin', 'main');
  const baseline = git('rev-parse', 'HEAD');
  const run = (args: string[] = [], overrides: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd,
      env: { ...env, ...overrides },
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ...result, output: result.stdout + result.stderr };
  };
  const stage = (name: string, text = name) => {
    writeFileSync(join(cwd, name), text);
    git('add', name);
  };
  const remoteGit = (...args: string[]) =>
    execFileSync('git', ['--git-dir', remote, ...args], { env, encoding: 'utf8' }).trim();
  return {
    base,
    cwd,
    remote,
    env,
    git,
    baseline,
    run,
    stage,
    remoteGit,
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

function published(f: ReturnType<typeof fixture>, version: string) {
  const pkg = JSON.parse(readFileSync(join(f.cwd, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(f.cwd, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, version);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  assert.equal(
    readFileSync(join(f.cwd, 'dist/version.txt'), 'utf8'),
    version,
    'build imports the new game version',
  );
  assert.equal(f.git('log', '-1', '--format=%s'), `chore(release): ${version} [skip ci]`);
  assert.equal(f.remoteGit('rev-parse', `v${version}`), f.git('rev-parse', 'HEAD'));
  assert.equal(f.remoteGit('rev-parse', 'main'), f.git('rev-parse', 'HEAD'));
  assert.equal(
    JSON.parse(f.remoteGit('show', `v${version}:package.json`)).version,
    version,
    'remote tag includes the version files',
  );
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(f.git('ls-files', 'dist/version.txt'), '', 'generated build is not committed');
}

test(
  'local semantic release commits staged work, bumps files, builds and pushes matching tags; previews and retries do not duplicate releases',
  { timeout: 120000 },
  () => {
    const f = fixture();
    try {
      f.stage('feature.txt');
      const initial = f.run(['feat(lobby): show the game version']);
      assert.equal(initial.status, 0, initial.output);
      published(f, '1.0.0');
      assert.match(readFileSync(join(f.cwd, 'CHANGELOG.md'), 'utf8'), /show the game version/);

      f.stage('fix.txt');
      f.git('commit', '-m', 'fix(lobby): keep the version readable');
      const head = f.git('rev-parse', 'HEAD'),
        remoteHead = f.remoteGit('rev-parse', 'main');
      const changelog = readFileSync(join(f.cwd, 'CHANGELOG.md'), 'utf8');
      const preview = f.run(['--dry-run']);
      assert.equal(preview.status, 0, preview.output);
      assert.equal(f.git('rev-parse', 'HEAD'), head);
      assert.equal(f.remoteGit('rev-parse', 'main'), remoteHead);
      assert.equal(readFileSync(join(f.cwd, 'CHANGELOG.md'), 'utf8'), changelog);
      assert.equal(f.remoteGit('tag', '--list', 'v1.0.1'), '');
      assert.match(preview.output, /1\.0\.1/);
      const existing = f.run();
      assert.equal(existing.status, 0, existing.output);
      published(f, '1.0.1');

      for (const [message, version, name] of [
        ['feat: add track selection', '1.1.0', 'tracks.txt'],
        ['docs: explain track selection', '1.1.1', 'guide.txt'],
        ['feat(protocol)!: replace controller commands', '2.0.0', 'protocol.txt'],
      ]) {
        f.stage(name);
        const result = f.run([message]);
        assert.equal(result.status, 0, result.output);
        published(f, version);
      }
      const tags = f.remoteGit('tag', '--list');
      const releasedHead = f.git('rev-parse', 'HEAD');
      const again = f.run();
      assert.equal(again.status, 0, again.output);
      assert.equal(f.git('rev-parse', 'HEAD'), releasedHead);
      assert.equal(f.remoteGit('tag', '--list'), tags);
      assert.match(again.output, /No new version/);
    } finally {
      f.dispose();
    }
  },
);

test('release rejects unrelated files, malformed messages, CI and non-main branches before creating commits or tags', () => {
  const f = fixture();
  try {
    f.stage('feature.txt');
    writeFileSync(join(f.cwd, 'unrelated.txt'), 'Keep this local.');
    const dirty = f.run(['feat: add feature']);
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.output, /Unstaged or untracked/);
    rmSync(join(f.cwd, 'unrelated.txt'));
    assert.match(f.run(['ordinary commit']).output, /Conventional Commit/);
    assert.match(f.run(['feat: add feature'], { CI: 'true' }).output, /run locally/);
    assert.match(f.run(['--dry-run']).output, /existing commits only/);
    f.git('switch', '-c', 'feature');
    assert.match(f.run(['feat: add feature']).output, /Release from main/);
    assert.equal(f.git('rev-parse', 'HEAD'), f.baseline);
    assert.equal(f.remoteGit('rev-parse', 'main'), f.baseline);
    assert.equal(f.remoteGit('tag', '--list'), '');
    assert.equal(f.git('diff', '--cached', '--name-only'), 'feature.txt');
  } finally {
    f.dispose();
  }
});

test('a failed project check retains staged work and never commits or publishes it', () => {
  const f = fixture({ checkFails: true });
  try {
    f.stage('feature.txt');
    const result = f.run(['feat: add feature']);
    assert.notEqual(result.status, 0);
    assert.equal(f.git('rev-parse', 'HEAD'), f.baseline);
    assert.equal(f.remoteGit('rev-parse', 'main'), f.baseline);
    assert.equal(f.remoteGit('tag', '--list'), '');
    assert.equal(f.git('diff', '--cached', '--name-only'), 'feature.txt');
  } finally {
    f.dispose();
  }
});

test('a failed versioned build leaves the local commit for inspection but publishes no release or tag', () => {
  const f = fixture({ buildFails: true });
  try {
    f.stage('feature.txt');
    const result = f.run(['feat: add feature']);
    assert.notEqual(result.status, 0);
    assert.equal(f.git('log', '-1', '--format=%s'), 'feat: add feature');
    assert.equal(f.remoteGit('rev-parse', 'main'), f.baseline);
    assert.equal(f.remoteGit('tag', '--list'), '');
    assert.equal(JSON.parse(readFileSync(join(f.cwd, 'package.json'), 'utf8')).version, '1.0.0');
  } finally {
    f.dispose();
  }
});

test('a remote branch advance is detected before a new local commit is made', () => {
  const f = fixture();
  try {
    const other = join(f.base, 'other');
    execFileSync('git', ['clone', f.remote, other], { env: f.env, stdio: 'pipe' });
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: other, env: f.env, stdio: 'pipe' });
    git('config', 'user.name', 'Other QA');
    git('config', 'user.email', 'other-qa@example.invalid');
    writeFileSync(join(other, 'remote.txt'), 'Remote update.');
    git('add', 'remote.txt');
    git('commit', '-m', 'fix: update remote');
    git('push', 'origin', 'main');
    f.stage('feature.txt');
    const result = f.run(['feat: add feature']);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /behind or diverged/);
    assert.equal(f.git('rev-parse', 'HEAD'), f.baseline);
    assert.equal(f.remoteGit('tag', '--list'), '');
  } finally {
    f.dispose();
  }
});
