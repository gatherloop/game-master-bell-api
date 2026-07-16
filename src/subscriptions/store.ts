import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { PushSubscription } from "./schema.js";

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

export interface SubscriptionStore {
  /** Idempotent upsert keyed by endpoint (FR-A5). */
  upsert(subscription: PushSubscription): void;
  remove(endpoint: string): void;
  all(): StoredSubscription[];
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

/** SQLite-backed subscription store (§6: `subscriptions` table). */
export class SqliteSubscriptionStore implements SubscriptionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        endpoint    TEXT PRIMARY KEY,
        p256dh      TEXT NOT NULL,
        auth        TEXT NOT NULL,
        created_at  TEXT NOT NULL
      )
    `);
  }

  upsert(subscription: PushSubscription): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (endpoint, p256dh, auth, created_at)
         VALUES (@endpoint, @p256dh, @auth, @createdAt)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = @p256dh, auth = @auth`,
      )
      .run({
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        createdAt: new Date().toISOString(),
      });
  }

  remove(endpoint: string): void {
    this.db.prepare(`DELETE FROM subscriptions WHERE endpoint = ?`).run(endpoint);
  }

  all(): StoredSubscription[] {
    const rows = this.db
      .prepare(`SELECT endpoint, p256dh, auth, created_at FROM subscriptions`)
      .all() as SubscriptionRow[];
    return rows.map((row) => ({
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      createdAt: row.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
