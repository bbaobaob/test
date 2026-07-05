const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { STATS_DB_PATH, STATS_PRUNE_AFTER } = require('../config/config');
const logger = require('../config/logger');

class StatsDB {
  constructor() {
    this._db = new DatabaseSync(STATS_DB_PATH);
    this._db.exec('PRAGMA journal_mode=WAL');
    this._db.exec('PRAGMA synchronous=NORMAL');
    this._db.exec('PRAGMA cache_size=-512');
    this._db.exec('PRAGMA temp_store=MEMORY');
    this._initTables();
    this._migrateFromJson();
  }

  _initTables() {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT    NOT NULL,
        user_name   TEXT    NOT NULL,
        role_name   TEXT    NOT NULL,
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
    `);
  }

  _migrateFromJson() {
    const oldPath = path.join(__dirname, '..', 'data', 'stats.json');
    const fs = require('fs');
    if (!fs.existsSync(oldPath)) return;

    const row = this._db.prepare('SELECT COUNT(*) as cnt FROM assignments').get();
    if (row && row.cnt > 0) return;

    try {
      const raw = fs.readFileSync(oldPath, 'utf-8');
      const data = JSON.parse(raw);
      const insert = this._db.prepare(
        'INSERT INTO assignments(user_id, user_name, role_name, removed_raw, ts, day) VALUES (?, ?, ?, ?, ?, ?)'
      );
      let count = 0;
      this._db.exec('BEGIN');
      for (const a of (data.assignments || [])) {
        insert.run(
          String(a.user_id || a.uid || '?'),
          a.user_name || a.name || '?',
          a.role_name || a.role || '?',
          JSON.stringify(a.removed || []),
          a.ts || new Date().toISOString(),
          (a.ts || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
        );
        count++;
      }
      this._db.exec('COMMIT');
      logger.info(`Stats migration: imported ${count} rows from stats.json`);
      fs.renameSync(oldPath, oldPath + '.bak');
      logger.info(`Stats migration: archived stats.json -> stats.json.bak`);
    } catch (err) {
      this._db.exec('ROLLBACK');
      logger.warn(`Stats migration error: ${err.message}`);
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

  record(userId, userName, roleName, removedNames) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const day = ts.slice(0, 10);
    this._db.prepare(
      'INSERT INTO assignments(user_id, user_name, role_name, removed_raw, ts, day) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(String(userId), userName, roleName, JSON.stringify(removedNames || []), ts, day);
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
      'SELECT role_name, COUNT(*) as cnt FROM assignments GROUP BY role_name ORDER BY cnt DESC LIMIT ?'
    ).all(n).map(r => [r.role_name, r.cnt]);
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

  userRole(userId) {
    const row = this._db.prepare(
      'SELECT role_name FROM assignments WHERE user_id=? ORDER BY id DESC LIMIT 1'
    ).get(String(userId));
    return row ? row.role_name : null;
  }

  dailyStats(days = 7) {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    const startStr = start.toISOString().slice(0, 10);
    const rows = this._db.prepare(
      'SELECT day, COUNT(*) as cnt FROM assignments WHERE day>=? GROUP BY day ORDER BY day ASC'
    ).all(startStr);
    const result = {};
    for (const r of rows) result[r.day] = r.cnt;
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      const key = d.toISOString().slice(0, 10);
      out.push([key, result[key] || 0]);
    }
    return out;
  }

  roleHistory(roleName) {
    return this._db.prepare(`
      SELECT a.* FROM assignments a
      INNER JOIN (
        SELECT user_id, MAX(id) as max_id
        FROM assignments GROUP BY user_id
      ) b ON a.id = b.max_id
      WHERE a.role_name=?
      ORDER BY a.id DESC
    `).all(roleName).map(this._rowToEntry);
  }

  roleAssignmentCount(roleName) {
    const row = this._db.prepare(
      'SELECT COUNT(*) as cnt FROM assignments WHERE role_name=?'
    ).get(roleName);
    return row ? row.cnt : 0;
  }

  prune(maxDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (maxDays || STATS_PRUNE_AFTER));
    const cutoffStr = cutoff.toISOString().slice(0, 19);
    const result = this._db.prepare('DELETE FROM assignments WHERE ts<?').run(cutoffStr);
    const removed = result.changes;
    if (removed) {
      this._db.exec('VACUUM');
      logger.info(`Stats prune: removed ${removed} records older than ${maxDays || STATS_PRUNE_AFTER} days.`);
    }
    return removed;
  }

  exportJson() {
    const rows = this._db.prepare('SELECT * FROM assignments ORDER BY id DESC').all();
    return {
      total_assignments: this.total,
      unique_users: this.uniqueUsers,
      assignments: rows.map(r => this._rowToEntry(r)),
      exported_at: new Date().toISOString(),
    };
  }
}

module.exports = StatsDB;
