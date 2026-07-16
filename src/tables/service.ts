import {
  loadInitialTables,
  refreshTables,
  type SyncLogger,
  type TablesSyncOptions,
} from "./sync.js";
import type { Table } from "./schema.js";

export interface TablesLookup {
  findByCode(code: string): Table | undefined;
}

export interface TablesServiceOptions extends TablesSyncOptions {
  logger: SyncLogger;
  refreshIntervalMs: number;
}

/**
 * Owns the in-memory tables snapshot: loads it at startup (throwing only if
 * no copy — remote or cached — is available) and refreshes it on an
 * interval, keeping the last good copy whenever a refresh fails.
 */
export class TablesService implements TablesLookup {
  private tables: Table[];
  private timer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly options: TablesServiceOptions,
    initial: Table[],
  ) {
    this.tables = initial;
  }

  static async start(options: TablesServiceOptions): Promise<TablesService> {
    const initial = await loadInitialTables(options);
    const service = new TablesService(options, initial);
    service.timer = setInterval(() => {
      void service.refresh();
    }, options.refreshIntervalMs);
    service.timer.unref();
    return service;
  }

  private async refresh(): Promise<void> {
    const next = await refreshTables(this.options);
    if (next) {
      this.tables = next;
    }
  }

  findByCode(code: string): Table | undefined {
    return this.tables.find((table) => table.code === code && table.active);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
