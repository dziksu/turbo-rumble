export type ScreenAwakeStatus =
  'unsupported' | 'off' | 'waiting' | 'requesting' | 'active' | 'blocked';

export interface ScreenLock {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void, options: { once: true }): void;
}

/** Own one native screen lock, including requests that resolve after navigation or hiding. */
export class ScreenAwake {
  private lock: ScreenLock | null = null;
  private requesting = false;
  private blocked = false;
  private disposed = false;
  private revision = 0;
  private enabled: boolean;
  private visible: boolean;
  onChange = () => {};

  constructor(
    private readonly request: (() => Promise<ScreenLock>) | undefined,
    enabled = true,
    visible = true,
  ) {
    this.enabled = enabled;
    this.visible = visible;
  }

  get wanted() {
    return this.enabled;
  }
  get status(): ScreenAwakeStatus {
    if (!this.request) return 'unsupported';
    if (this.disposed || !this.enabled) return 'off';
    if (!this.visible) return 'waiting';
    if (this.lock && !this.lock.released) return 'active';
    if (this.requesting) return 'requesting';
    return this.blocked ? 'blocked' : 'waiting';
  }

  setEnabled(enabled: boolean) {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.revision++;
      this.blocked = false;
      if (!enabled) this.release();
      this.onChange();
    }
    return this.refresh();
  }

  setVisible(visible: boolean) {
    if (this.visible !== visible) {
      this.visible = visible;
      this.revision++;
      this.blocked = false;
      if (!visible) this.release();
      this.onChange();
    }
    return this.refresh();
  }

  async refresh(): Promise<void> {
    if (
      !this.request ||
      this.disposed ||
      !this.enabled ||
      !this.visible ||
      this.requesting ||
      this.lock
    )
      return;
    this.requesting = true;
    this.blocked = false;
    const revision = this.revision;
    this.onChange();
    try {
      const lock = await this.request();
      if (this.disposed || revision !== this.revision || !this.enabled || !this.visible) {
        await lock.release().catch(() => {});
      } else if (lock.released) {
        this.blocked = true;
      } else {
        this.lock = lock;
        lock.addEventListener(
          'release',
          () => {
            if (this.lock !== lock) return;
            this.lock = null;
            // Respect a system revocation. Retry on return to the tab or a user action, never in a loop.
            this.blocked = true;
            this.onChange();
          },
          { once: true },
        );
      }
    } catch {
      if (revision === this.revision) this.blocked = true;
    } finally {
      this.requesting = false;
      this.onChange();
      if (revision !== this.revision) await this.refresh();
    }
  }

  private release() {
    const lock = this.lock;
    this.lock = null;
    if (lock) void lock.release().catch(() => {});
  }

  dispose() {
    this.disposed = true;
    this.revision++;
    this.release();
    this.onChange();
  }
}
