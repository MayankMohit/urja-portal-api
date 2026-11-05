import type { PortalLogger } from '../portal/client.js';

// One captured debug line from the portal client (method, path, status, ms,
// attempt, or an error marker). Kept loose because it mirrors whatever the
// client logs.
export interface LogEntry {
  msg?: string;
  [key: string]: unknown;
}

// A PortalLogger that keeps every debug line in memory instead of printing it.
// The crawl script passes one of these to the client, then writes `entries` to
// crawl-log.json. This reuses the client's existing request instrumentation as
// the single source of per-request timing, rather than timing again here.
export class RecordingLogger implements PortalLogger {
  readonly entries: LogEntry[] = [];

  debug(obj: Record<string, unknown>, msg?: string): void {
    this.entries.push({ ...obj, msg });
  }
}
