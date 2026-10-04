import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Collections } from "./types.js";
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL, event TEXT NOT NULL, occurred_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;`);
  }
  get<K extends keyof Collections>(
    collection: K,
    id: string,
  ): Collections[K] | undefined {
    const row = this.db
      .prepare("SELECT data FROM records WHERE collection=? AND id=?")
      .get(collection, id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  all<K extends keyof Collections>(collection: K): Collections[K][] {
    return (
      this.db
        .prepare("SELECT data FROM records WHERE collection=? ORDER BY id")
        .all(collection) as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
  put<K extends keyof Collections>(collection: K, value: Collections[K]): void {
    this.db
      .prepare(
        "INSERT INTO records(collection,id,data) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data",
      )
      .run(collection, value.id, JSON.stringify(value));
  }
  delete<K extends keyof Collections>(collection: K, id: string) {
    this.db
      .prepare("DELETE FROM records WHERE collection=? AND id=?")
      .run(collection, id);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  audit(
    customerId: string,
    event: string,
    data: Record<string, unknown>,
    now: number,
  ) {
    this.db
      .prepare(
        "INSERT INTO audit(customer_id,event,occurred_at,data) VALUES(?,?,?,?)",
      )
      .run(
        customerId,
        event,
        new Date(now).toISOString(),
        JSON.stringify(data),
      );
  }
  auditFor(customerId: string) {
    return this.db
      .prepare(
        "SELECT sequence,event,occurred_at AS occurredAt,data FROM audit WHERE customer_id=? ORDER BY sequence DESC LIMIT 200",
      )
      .all(customerId)
      .map((row) => ({
        sequence: Number(row.sequence),
        event: String(row.event),
        occurredAt: String(row.occurredAt),
        data: JSON.parse(row.data as string),
      }));
  }
  close() {
    this.db.close();
  }
}
