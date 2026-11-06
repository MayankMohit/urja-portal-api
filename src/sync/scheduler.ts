import type { PortalClient } from '../portal/client.js';
import type { SnapshotStore, SyncStatus } from '../store/snapshot.js';
import { loadSnapshot } from '../store/persistence.js';
import { runSync, type SyncLogger } from './sync.js';

export interface SchedulerOptions {
  client: PortalClient;
  store: SnapshotStore;
  intervalHours: number;
  logger: SyncLogger;
}

export class SyncScheduler {
  private readonly client: PortalClient;
  private readonly store: SnapshotStore;
  private readonly intervalHours: number;
  private readonly logger: SyncLogger;

  private inFlight: Promise<SyncStatus> | null = null;
  private lastStatus: SyncStatus | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: SchedulerOptions) {
    this.client = options.client;
    this.store = options.store;
    this.intervalHours = options.intervalHours;
    this.logger = options.logger;
  }

  triggerSync(): Promise<SyncStatus> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = runSync(this.client, this.store, this.logger)
      .then((status) => {
        this.lastStatus = status;
        return status;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  isSyncing(): boolean {
    return this.inFlight !== null;
  }

  getLastStatus(): SyncStatus | null {
    return this.lastStatus;
  }
  
  async start(): Promise<void> {
    const loaded = await loadSnapshot();
    if (loaded) {
      this.store.replace(loaded);
      this.lastStatus = loaded.sync;
      this.logger.info(
        `Loaded snapshot from disk: ${loaded.meters.size} meters, data as of ${loaded.dataAsOf ?? 'n/a'}.`,
      );
    } else {
      this.logger.info('No snapshot on disk; the first sync will build one.');
    }

    void this.triggerSync().catch((err) => this.logger.error(`Initial sync threw: ${String(err)}`));

    const intervalMs = this.intervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.triggerSync().catch((err) => this.logger.error(`Scheduled sync threw: ${String(err)}`));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
