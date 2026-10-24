import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScreenAwake, type ScreenLock } from '../client/screen-awake.ts';

class Lock extends EventTarget implements ScreenLock {
  released = false;
  releases = 0;
  async release() {
    this.releases++;
    this.revoke();
  }
  revoke() {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  }
}

function provider() {
  const locks: Lock[] = [];
  return {
    locks,
    request: async () => {
      const lock = new Lock();
      locks.push(lock);
      return lock;
    },
  };
}

test('one native lock covers the visible room; opt-out releases it and stays off', async () => {
  const p = provider(),
    screen = new ScreenAwake(p.request);
  await screen.refresh();
  assert.equal(screen.status, 'active');
  await screen.refresh();
  await screen.refresh();
  assert.equal(p.locks.length, 1);
  await screen.setEnabled(false);
  assert.equal(screen.status, 'off');
  assert.equal(p.locks[0].releases, 1);
  await screen.setVisible(false);
  await screen.setVisible(true);
  await screen.refresh();
  assert.equal(p.locks.length, 1, 'visibility or gestures never undo the user opt-out');
  await screen.setEnabled(true);
  assert.equal(screen.status, 'active');
  assert.equal(p.locks.length, 2);
  screen.dispose();
});

test('hidden tabs do not request locks; returning from hiding or bfcache gets a fresh lock', async () => {
  const p = provider(),
    screen = new ScreenAwake(p.request, true, false);
  await screen.refresh();
  assert.equal(p.locks.length, 0);
  assert.equal(screen.status, 'waiting');
  await screen.setVisible(true);
  assert.equal(screen.status, 'active');
  await screen.setVisible(false);
  assert.equal(p.locks[0].released, true);
  assert.equal(screen.status, 'waiting');
  await screen.setVisible(true);
  assert.equal(p.locks.length, 2);
  assert.equal(screen.status, 'active');
  screen.dispose();
});

test('system revocation is reported without a request loop; a user retry reacquires', async () => {
  const p = provider(),
    screen = new ScreenAwake(p.request);
  await screen.refresh();
  p.locks[0].revoke();
  assert.equal(screen.status, 'blocked');
  assert.equal(p.locks.length, 1);
  await screen.refresh();
  assert.equal(screen.status, 'active');
  screen.dispose();
});

test('concurrent requests coalesce; a lock arriving after hide/show is released before reacquiring', async () => {
  let resolve!: (lock: ScreenLock) => void;
  const old = new Lock(),
    current = new Lock();
  let calls = 0;
  const screen = new ScreenAwake(() =>
    ++calls === 1
      ? new Promise<ScreenLock>((done) => {
          resolve = done;
        })
      : Promise.resolve(current),
  );
  const pending = screen.refresh();
  assert.equal(screen.status, 'requesting');
  await screen.refresh();
  await screen.setVisible(false);
  await screen.setVisible(true);
  assert.equal(calls, 1);
  resolve(old);
  await pending;
  assert.equal(old.releases, 1);
  assert.equal(calls, 2);
  assert.equal(screen.status, 'active');
  screen.dispose();
  assert.equal(current.releases, 1);
});

for (const action of ['disable', 'dispose'] as const) {
  test(`a late lock is released after ${action}, without reacquiring`, async () => {
    let resolve!: (lock: ScreenLock) => void;
    const lock = new Lock();
    let calls = 0;
    const screen = new ScreenAwake(() => {
      calls++;
      return new Promise<ScreenLock>((done) => {
        resolve = done;
      });
    });
    const pending = screen.refresh();
    if (action === 'disable') await screen.setEnabled(false);
    else screen.dispose();
    resolve(lock);
    await pending;
    assert.equal(lock.releases, 1);
    assert.equal(calls, 1);
    assert.equal(screen.status, 'off');
  });
}

test('denied requests remain nonfatal and can be retried on a later interaction', async () => {
  const lock = new Lock();
  let calls = 0;
  const screen = new ScreenAwake(async () => {
    if (++calls === 1) throw new Error('NotAllowedError');
    return lock;
  });
  await screen.refresh();
  assert.equal(screen.status, 'blocked');
  assert.equal(calls, 1);
  await screen.refresh();
  assert.equal(screen.status, 'active');
  screen.dispose();
});

test('unsupported browsers and HTTP do not pretend the screen is protected', async () => {
  const screen = new ScreenAwake(undefined);
  await screen.refresh();
  assert.equal(screen.status, 'unsupported');
  await screen.setEnabled(false);
  await screen.setVisible(false);
  screen.dispose();
  assert.equal(screen.status, 'unsupported');
});

test('a saved opt-out starts inactive, and an already released grant is reported as blocked', async () => {
  const lock = new Lock();
  lock.revoke();
  let calls = 0;
  const screen = new ScreenAwake(async () => {
    calls++;
    return lock;
  }, false);
  await screen.refresh();
  assert.equal(screen.status, 'off');
  assert.equal(calls, 0);
  await screen.setEnabled(true);
  assert.equal(screen.status, 'blocked');
  assert.equal(calls, 1);
  screen.dispose();
});
