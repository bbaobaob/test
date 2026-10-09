// test/statsDb.test.js — StatsDB migration + prune + export behavior.
//
// The constructor takes an optional db path so tests can point it at a temp
// directory and exercise the migration/prune/export paths without touching
// production data.
'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// statsDb.js exports the class directly (module.exports = StatsDB).
const StatsDB = require('../utils/statsDb');

const tmpDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zzz-stats-'));
  tmpDirs.push(dir);
  return dir;
}

function writeStatsJson(dir, data) {
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(data), 'utf-8');
}

after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

describe('StatsDB migration', () => {
  it('migrates stats.json into the DB when the table is empty', () => {
    const dir = makeTempDir();
    writeStatsJson(dir, {
      assignments: [
        { user_id: 'u1', user_name: 'Alice', role_name: 'Dragon', action: 'add', ts: '2024-01-01T10:00:00' },
        { user_id: 'u2', user_name: 'Bob', role_name: 'Scythe', action: 'remove', ts: '2024-01-02T10:00:00' },
      ],
    });

    const db = new StatsDB(path.join(dir, 'stats.db'));
    assert.strictEqual(db.total, 2, 'should import both rows');
    assert.strictEqual(fs.existsSync(path.join(dir, 'stats.json')), false, 'original should be renamed to .bak');
    assert.strictEqual(fs.existsSync(path.join(dir, 'stats.json.bak')), true, 'original should be backed up');
    db.close();
  });

  it('does not crash when stats.json is corrupted JSON', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'stats.json'), '{ not valid json !!!', 'utf-8');

    // The constructor must not throw — a bad file must not block bot startup.
    assert.doesNotThrow(() => new StatsDB(path.join(dir, 'stats.db')));
    assert.strictEqual(fs.existsSync(path.join(dir, 'stats.json')), false, 'bad file should be renamed to .failed');
    assert.strictEqual(fs.existsSync(path.join(dir, 'stats.json.failed')), true, 'bad file should be renamed to .failed');
  });

  it('does not migrate when the assignments table already has data', () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, 'stats.db');
    const db = new StatsDB(dbPath);
    db.record('u1', 'Alice', 'Dragon', [], 'add');
    assert.strictEqual(db.total, 1);
    db.close();

    // Write a stats.json that would otherwise be migrated on the next boot.
    writeStatsJson(dir, {
      assignments: [{ user_id: 'u9', user_name: 'Zoe', role_name: 'Sword', action: 'add', ts: '2024-05-01T10:00:00' }],
    });

    // Re-open the same DB — the table already has data, so migration must skip.
    const db3 = new StatsDB(dbPath);
    assert.strictEqual(db3.total, 1, 'migration must be skipped when data exists');
    assert.strictEqual(fs.existsSync(path.join(dir, 'stats.json')), true, 'stats.json must be left untouched');
    db3.close();
  });
});

describe('StatsDB prune', () => {
  it('prune deletes old rows', () => {
    const dir = makeTempDir();
    const db = new StatsDB(path.join(dir, 'stats.db'));
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T00:00:00`;
    db.recordBatch([
      { userId: 'u1', userName: 'Alice', roleName: 'Dragon', removedNames: [], action: 'add', ts: '2020-01-01T00:00:00', day: '2020-01-01' },
      { userId: 'u2', userName: 'Bob', roleName: 'Scythe', removedNames: [], action: 'add', ts: todayStr, day: todayStr.slice(0, 10) },
    ]);
    assert.strictEqual(db.total, 2);

    const removed = db.prune(30); // keep only rows newer than 30 days
    assert.strictEqual(removed, 1, 'only the 2020 row should be pruned');
    assert.strictEqual(db.total, 1);
    db.close();
  });
});

describe('StatsDB export', () => {
  it('exportJson caps the payload and exposes truncated flag', () => {
    const dir = makeTempDir();
    const db = new StatsDB(path.join(dir, 'stats.db'));
    for (let i = 0; i < 10; i++) {
      db.record(`u${i}`, `User${i}`, 'Dragon', [], 'add');
    }
    const data = db.exportJson(5);
    assert.strictEqual(data.total_assignments, 10, 'total_assignments reflects the real count');
    assert.strictEqual(data.assignments.length, 5, 'payload capped at maxRows');
    assert.strictEqual(data.truncated, true, 'truncated flag set when capped');
    assert.match(data.truncated_reason, /Capped at 5 rows of 10 total/);
    db.close();
  });

  it('exportJsonStream writes a valid JSON file without building a giant string', () => {
    const dir = makeTempDir();
    const db = new StatsDB(path.join(dir, 'stats.db'));
    for (let i = 0; i < 5; i++) {
      db.record(`u${i}`, `User${i}`, 'Dragon', [], 'add');
    }
    const outPath = path.join(dir, 'export.json');
    const result = db.exportJsonStream(outPath, { maxRows: 50_000 });
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.truncated, false);
    assert.strictEqual(fs.existsSync(outPath), true);
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    assert.strictEqual(parsed.assignments.length, 5);
    assert.strictEqual(parsed.total_assignments, 5);
    db.close();
  });
});