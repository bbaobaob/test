const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { STATS_DB_PATH, STATS_PRUNE_AFTER } = require('../config/config');
const logger = require('../config/logger');

// Only VACUUM when the DB is large enough that the synchronous rewrite is
// worth the event-loop block. Smaller DBs rely on WAL auto-checkpoint.
const VACUUM_MIN_BYTES = 5 * 1024 * 1024; // 5 MiB

// Cap the in-memory export payload so a single /export can't balloon RAM.
const EXPORT_JSON_MAX_ROWS = 50_000;

class StatsDB {
  constructor(dbPath = STATS_DB_PATH) {
    this._dbPath = dbPath;
    this._db = new DatabaseSync(dbPath);
    this._db.exec('PRAGMA journal_mode=WAL');
    this._db.exec('PRAGMA synchronous=NORMAL');
    this._db.exec('PRAGMA busy_timeout=5000');   // wait on lock instead of throwing under concurrency
    this._db.exec('PRAGMA cache_size=-2048');     // 2MB page cache (was 512KB) — faster reads
    this._db.exec('PRAGMA temp_store=MEMORY');
    this._db.exec('PRAGMA wal_autocheckpoint=100'); // checkpoint every 100 pages (was 1000) — keeps -wal tiny
    this._initTables();
    this._migrateFromJson();
    // Collapse any stale/oversized WAL left by a previous crash into the main
    // db and truncate it so we don't carry megabytes of dead journal.
    try { this._db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
  }

  _initTables() {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT    NOT NULL,
        user_name   TEXT    NOT NULL,
        role_name   TEXT    NOT NULL,
        action      TEXT    NOT NULL DEFAULT 'add',
        removed_raw TEXT    NOT NULL DEFAULT '[]',
        ts          TEXT    NOT NULL,
        day         TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assign_user ON assignments(user_id);
      CREATE INDEX IF NOT EXISTS idx_assign_role ON assignments(role_name);
      CREATE INDEX IF NOT EXISTS idx_assign_day  ON assignments(day);
      CREATE INDEX IF NOT EXISTS idx_assign_ts   ON assignments(ts);
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS gayrate_seeds (
        user_id TEXT PRIMARY KEY,
        seed    INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    try { this._db.exec("ALTER TABLE assignments ADD COLUMN action TEXT NOT NULL DEFAULT 'add'"); } catch (_) {}
    try { this._db.exec('CREATE INDEX IF NOT EXISTS idx_assign_action ON assignments(action)'); } catch (_) {}
  }

  _migrateFromJson() {
    // Look for stats.json next to the database file so tests can point the
    // DB at a temp dir and still exercise the migration path.
    const dbDir = path.dirname(this._dbPath || STATS_DB_PATH);
    const oldPath = path.join(dbDir, 'stats.json');
    if (!fs.existsSync(oldPath)) return;

    const row = this._db.prepare('SELECT COUNT(*) as cnt FROM assignments').get();
    if (row && row.cnt > 0) return;

    // Declared outside try so the catch block can read it — a `let` scoped
    // inside the try block is invisible to catch.
    let txStarted = false;
    try {
      const raw = fs.readFileSync(oldPath, 'utf-8');
      const data = JSON.parse(raw);
      const insert = this._db.prepare(
        'INSERT INTO assignments(user_id, user_name, role_name, action, removed_raw, ts, day) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      let count = 0;
      this._db.exec('BEGIN');
      txStarted = true;
      for (const a of (data.assignments || [])) {
        insert.run(
          String(a.user_id || a.uid || '?'),
          a.user_name || a.name || '?',
          a.role_name || a.role || '?',
          a.action || 'add',
          JSON.stringify(a.removed || []),
          a.ts || new Date().toISOString(),
          (a.ts || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
        );
        count++;
      }
      this._db.exec('COMMIT');
      txStarted = false;
      logger.info(`Di chuyển stats: đã nhập ${count} dòng từ stats.json`);
      fs.renameSync(oldPath, oldPath + '.bak');
      logger.info(`Di chuyển stats: đã lưu trữ stats.json -> stats.json.bak`);
    } catch (err) {
      // Only roll back if we actually started a transaction — a failure before
      // BEGIN (e.g. corrupted JSON) would otherwise throw "cannot rollback -
      // no transaction is active" and crash the bot at startup.
      if (txStarted) {
        try { this._db.exec('ROLLBACK'); } catch (_) {}
      }
      // Leave the bad file in place (renamed to .failed) so an admin can
      // inspect it instead of silently losing data on the next boot.
      try { fs.renameSync(oldPath, oldPath + '.failed'); } catch (_) {}
      logger.warn(`Lỗi di chuyển stats: ${err.message}`);
    }
  }

  close() {
    try { this.flush(); } catch {}
    try {
      if (this._db) {
        this._db.close();
        this._db = null;
      }
    } catch {}
  }

  flush() {
    // WAL mode checkpoints automatically; explicit checkpoint here for safety
    try {
      if (this._db) {
        this._db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      }
    } catch {}
  }

  _localDateStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  _localTsStr(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  record(userId, userName, roleName, removedNames, action = 'add') {
    const now = new Date();
    const ts = this._localTsStr(now);
    const day = this._localDateStr(now);
    if (!this._insertStmt) {
      this._insertStmt = this._db.prepare(
        'INSERT INTO assignments(user_id, user_name, role_name, action, removed_raw, ts, day) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
    }
    this._insertStmt.run(String(userId), userName, roleName, action, JSON.stringify(removedNames || []), ts, day);
  }

  /**
   * Batch insert many assignment events in a single transaction. Used by the
   * RoleBatcher so N rapid clicks become ONE disk write instead of N.
   * @param {Array<{userId,userName,roleName,removedNames,action?,ts?,day?}>} entries
   */
  recordBatch(entries) {
    if (!entries || !entries.length) return;
    if (!this._insertStmt) {
      this._insertStmt = this._db.prepare(
        'INSERT INTO assignments(user_id, user_name, role_name, action, removed_raw, ts, day) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
    }
    this._db.exec('BEGIN');
    try {
      for (const e of entries) {
        const now = new Date();
        this._insertStmt.run(
          String(e.userId), e.userName, e.roleName,
          e.action || 'add',
          JSON.stringify(e.removedNames || []),
          e.ts || this._localTsStr(now),
          e.day || this._localDateStr(now)
        );
      }
      this._db.exec('COMMIT');
    } catch (err) {
      this._db.exec('ROLLBACK');
      throw err;
    }
  }

  get total() {
    const row = this._db.prepare('SELECT COUNT(*) as cnt FROM assignments').get();
    return row ? row.cnt : 0;
  }

  get uniqueUsers() {
    const row = this._db.prepare('SELECT COUNT(DISTINCT user_id) as cnt FROM assignments').get();
    return row ? row.cnt : 0;
  }

  topRoles(n = 10) {
    return this._db.prepare(
      "SELECT role_name, COUNT(*) as cnt FROM assignments WHERE action='add' GROUP BY role_name ORDER BY cnt DESC LIMIT ?"
    ).all(n).map(r => [r.role_name, r.cnt]);
  }

  /** Top role names by total assignment count (for the graph command). */
  topRolesBySeries(n = 5) {
    return this._db.prepare(
      "SELECT role_name FROM assignments WHERE action='add' GROUP BY role_name ORDER BY COUNT(*) DESC LIMIT ?"
    ).all(n).map(r => r.role_name);
  }

  /**
   * Net holder count per role over `buckets` days (oldest -> newest).
   * Derives a cumulative count of assignment events per day. Since the table
   * logs additions (and clear-operations separately), we approximate net
   * holders as cumulative additions up to each day boundary.
   */
  roleNetSeries(roleName, buckets = 7) {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (buckets - 1));
    const startStr = this._localDateStr(start);

    const rows = this._db.prepare(
      `SELECT day,
              SUM(CASE WHEN action='add' THEN 1 WHEN action IN ('remove','clear') THEN -1 ELSE 0 END) as cnt
       FROM assignments
       WHERE role_name=? AND day>=?
       GROUP BY day ORDER BY day ASC`
    ).all(roleName, startStr);

    const byDay = {};
    for (const r of rows) byDay[r.day] = r.cnt;

    const out = [];
    for (let i = 0; i < buckets; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (buckets - 1 - i));
      const key = this._localDateStr(d);
      out.push(byDay[key] || 0);
    }
    // Convert per-day additions into a cumulative (monotonic) series.
    const cumulative = [];
    let running = 0;
    for (const v of out) {
      running = Math.max(0, running + v);
      cumulative.push(running);
    }
    return cumulative;
  }

  recentEntries(n = 10) {
    return this._db.prepare(
      'SELECT * FROM assignments ORDER BY id DESC LIMIT ?'
    ).all(n).map(this._rowToEntry);
  }

  _rowToEntry(row) {
    const entry = { ...row };
    try {
      entry.removed = JSON.parse(row.removed_raw || '[]');
    } catch {
      entry.removed = [];
    }
    entry.user = row.user_name;
    entry.name = row.user_name;
    entry.role = row.role_name;
    return entry;
  }

  userEntry(userId) {
    const row = this._db.prepare(
      'SELECT * FROM assignments WHERE user_id=? ORDER BY id DESC LIMIT 1'
    ).get(String(userId));
    return row ? this._rowToEntry(row) : null;
  }

  perUserChangeCount(userId) {
    const row = this._db.prepare(
      'SELECT COUNT(*) as cnt FROM assignments WHERE user_id=?'
    ).get(String(userId));
    return row ? row.cnt : 0;
  }

  dailyStats(days = 7) {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    const startStr = this._localDateStr(start);
    const rows = this._db.prepare(
      'SELECT day, COUNT(*) as cnt FROM assignments WHERE day>=? GROUP BY day ORDER BY day ASC'
    ).all(startStr);
    const result = {};
    for (const r of rows) result[r.day] = r.cnt;
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      const key = this._localDateStr(d);
      out.push([key, result[key] || 0]);
    }
    return out;
  }

  roleHistory(roleName) {
    return this._db.prepare(`
      SELECT a.* FROM assignments a
      INNER JOIN (
        SELECT user_id, role_name, MAX(id) as max_id
        FROM assignments GROUP BY user_id, role_name
      ) b ON a.id = b.max_id
      WHERE a.role_name=? AND a.action='add'
      ORDER BY a.id DESC
    `).all(roleName).map(this._rowToEntry);
  }

  roleAssignmentCount(roleName) {
    const row = this._db.prepare(
      "SELECT COUNT(*) as cnt FROM assignments WHERE role_name=? AND action='add'"
    ).get(roleName);
    return row ? row.cnt : 0;
  }

  prune(maxDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (maxDays || STATS_PRUNE_AFTER));
    const cutoffStr = this._localTsStr(cutoff);
    const result = this._db.prepare('DELETE FROM assignments WHERE ts<?').run(cutoffStr);
    const removed = result.changes;
    if (removed) {
      // VACUUM is a synchronous rewrite of the whole DB — only run it when the
      // file is large enough to justify the event-loop block, otherwise the
      // daily prune can stall the bot on a small database.
      const dbSize = this._dbSizeBytes();
      if (dbSize >= VACUUM_MIN_BYTES) {
        this._db.exec('VACUUM');
      }
      logger.info(`Dọn stats: đã xóa ${removed} bản ghi cũ hơn ${maxDays || STATS_PRUNE_AFTER} ngày.`);
    }
    return removed;
  }

  _dbSizeBytes() {
    try {
      return fs.statSync(this._dbPath || STATS_DB_PATH).size;
    } catch {
      return 0;
    }
  }

  exportJson(maxRows = EXPORT_JSON_MAX_ROWS) {
    const total = this.total;
    const capped = total > maxRows;
    const rows = this._db.prepare(
      'SELECT * FROM assignments ORDER BY id DESC LIMIT ?'
    ).all(capped ? maxRows : total);
    return {
      total_assignments: total,
      unique_users: this.uniqueUsers,
      assignments: rows.map(r => this._rowToEntry(r)),
      exported_at: new Date().toISOString(),
      truncated: capped,
      truncated_reason: capped
        ? `Capped at ${maxRows} rows of ${total} total. Use exportJsonStream() for the full set.`
        : null,
    };
  }

  /**
   * Stream the full assignment set to a temp file as JSON. Avoids building one
   * giant JSON string in RAM and on the event loop, which is important for
   * long-running bots with large stats tables.
   * @param {string} outPath — absolute path to write.
   * @param {{maxRows?:number}} opts
   * @returns {{path:string, total:number, truncated:boolean}}
   */
  exportJsonStream(outPath, opts = {}) {
    const maxRows = opts.maxRows == null ? EXPORT_JSON_MAX_ROWS : opts.maxRows;
    const total = this.total;
    const capped = total > maxRows;
    const fd = fs.openSync(outPath, 'w');
    try {
      fs.writeSync(fd, '{\n');
      fs.writeSync(fd, `  "total_assignments": ${total},\n`);
      fs.writeSync(fd, `  "unique_users": ${this.uniqueUsers},\n`);
      fs.writeSync(fd, `  "exported_at": ${JSON.stringify(new Date().toISOString())},\n`);
      fs.writeSync(fd, `  "truncated": ${capped},\n`);
      fs.writeSync(fd, `  "truncated_reason": ${JSON.stringify(capped ? `Capped at ${maxRows} rows of ${total} total.` : null)},\n`);
      fs.writeSync(fd, '  "assignments": [\n');

      const stmt = this._db.prepare('SELECT * FROM assignments ORDER BY id DESC');
      let first = true;
      let count = 0;
      for (const row of stmt.iterate()) {
        if (count >= maxRows) break;
        const entry = this._rowToEntry(row);
        const json = JSON.stringify(entry);
        fs.writeSync(fd, first ? `    ${json}` : `,\n    ${json}`);
        first = false;
        count++;
      }
      fs.writeSync(fd, '\n  ]\n}\n');
      return { path: outPath, total, truncated: capped };
    } finally {
      fs.closeSync(fd);
    }
  }

  getOrCreateGayrateSeed(userId) {
    const row = this._db.prepare('SELECT seed FROM gayrate_seeds WHERE user_id=?').get(String(userId));
    if (row) return row.seed;
    const seed = Math.floor(Math.random() * 1000000);
    const now = new Date().toISOString();
    try {
      this._db.prepare('INSERT INTO gayrate_seeds(user_id, seed, created_at) VALUES (?, ?, ?)').run(String(userId), seed, now);
    } catch (err) {
      const retry = this._db.prepare('SELECT seed FROM gayrate_seeds WHERE user_id=?').get(String(userId));
      if (retry) return retry.seed;
      throw err;
    }
    return seed;
  }

  resetGayrateSeed(userId) {
    const seed = Math.floor(Math.random() * 1000000);
    const now = new Date().toISOString();
    this._db.prepare('INSERT OR REPLACE INTO gayrate_seeds(user_id, seed, created_at) VALUES (?, ?, ?)').run(String(userId), seed, now);
    return seed;
  }

  resetAllGayrateSeeds() {
    this._db.exec('DELETE FROM gayrate_seeds');
  }

  getGayrateSeed(userId) {
    const row = this._db.prepare('SELECT seed FROM gayrate_seeds WHERE user_id=?').get(String(userId));
    return row ? row.seed : null;
  }
}

module.exports = StatsDB;
