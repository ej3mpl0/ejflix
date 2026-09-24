/**
 * Programme guide storage. The desktop keeps programmes in the catalog JSON; on Android
 * they go to SQLite so a 100 MiB guide never has to live in JS memory.
 */
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import type { EpgNow, Programme } from "../../lib/types";
import { EPG_PAST, type ProgrammeRow } from "./xmltv";

const DB_NAME = "iptv-epg.db";
const BATCH = 500;

let db: SQLiteDatabase | null = null;

function open(): SQLiteDatabase {
  if (db) return db;
  const handle = openDatabaseSync(DB_NAME);
  handle.execSync("PRAGMA journal_mode = WAL;");
  handle.execSync(
    `CREATE TABLE IF NOT EXISTS programme (
      source_id TEXT NOT NULL,
      xmltv_id TEXT NOT NULL,
      start INTEGER NOT NULL,
      stop INTEGER NOT NULL,
      title TEXT NOT NULL,
      "desc" TEXT,
      category TEXT,
      UNIQUE(source_id, xmltv_id, start, title)
    );`,
  );
  handle.execSync("CREATE INDEX IF NOT EXISTS programme_lookup ON programme(source_id, xmltv_id, stop);");
  // Staging rows left by a guide import the app did not live to finish.
  handle.runSync("DELETE FROM programme WHERE source_id LIKE '%#new%'");
  db = handle;
  return handle;
}

let stageSeq = 0;

/** Staging prefix of a source; every writer gets its own id under it. */
function stagePrefix(sourceId: string): string {
  return `${sourceId}#new`;
}

/**
 * Replaces the programmes of a source: rows are staged under `<id>#new#<n>` while the guide
 * streams in, then swapped in one transaction so readers never see a half-written guide.
 * The stage is per writer so an abandoned import cannot delete the rows of a newer one.
 */
export class EpgWriter {
  private readonly stage: string;

  constructor(private readonly sourceId: string) {
    stageSeq += 1;
    this.stage = `${stagePrefix(sourceId)}#${stageSeq}`;
    open();
  }

  insert(rows: ProgrammeRow[]): void {
    if (rows.length === 0) return;
    const handle = open();
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      handle.withTransactionSync(() => {
        const stmt = handle.prepareSync(
          'INSERT OR IGNORE INTO programme (source_id, xmltv_id, start, stop, title, "desc", category) VALUES (?, ?, ?, ?, ?, ?, ?)',
        );
        try {
          for (const row of slice) {
            stmt.executeSync([this.stage, row.xmltvId, row.start, row.stop, row.title, row.desc, row.category]);
          }
        } finally {
          stmt.finalizeSync();
        }
      });
    }
  }

  commit(): void {
    const handle = open();
    handle.withTransactionSync(() => {
      handle.runSync("DELETE FROM programme WHERE source_id = ?", this.sourceId);
      handle.runSync("UPDATE programme SET source_id = ? WHERE source_id = ?", this.sourceId, this.stage);
    });
  }

  abort(): void {
    try {
      open().runSync("DELETE FROM programme WHERE source_id = ?", this.stage);
    } catch {
      /* best effort */
    }
  }
}

export function deleteProgrammes(sourceId: string): void {
  try {
    const handle = open();
    // Source ids are `[A-Za-z0-9-]` only, so the LIKE pattern has no wildcards of its own.
    handle.runSync(
      "DELETE FROM programme WHERE source_id = ? OR source_id LIKE ?",
      sourceId,
      `${stagePrefix(sourceId)}#%`,
    );
  } catch {
    /* no database yet */
  }
}

type Row = { start: number; stop: number; title: string; desc: string | null; category: string | null };

function toProgramme(row: Row): Programme {
  return { start: row.start, stop: row.stop, title: row.title, desc: row.desc ?? null, category: row.category ?? null };
}

/** Programme on air and the next one (same rule as the desktop `partition_point` lookup). */
export function epgNow(sourceId: string, xmltvId: string, now: number): EpgNow {
  const rows = open().getAllSync<Row>(
    'SELECT start, stop, title, "desc", category FROM programme WHERE source_id = ? AND xmltv_id = ? AND stop > ? ORDER BY start LIMIT 2',
    sourceId,
    xmltvId,
    now,
  );
  const first = rows[0] ? toProgramme(rows[0]) : null;
  const second = rows[1] ? toProgramme(rows[1]) : null;
  const current = first && first.start <= now ? first : null;
  return { now: current, next: current ? second : first };
}

export function epgChannel(sourceId: string, xmltvId: string, now: number): Programme[] {
  const rows = open().getAllSync<Row>(
    'SELECT start, stop, title, "desc", category FROM programme WHERE source_id = ? AND xmltv_id = ? AND stop > ? ORDER BY start LIMIT 200',
    sourceId,
    xmltvId,
    Math.max(0, now - EPG_PAST),
  );
  return rows.map(toProgramme);
}
