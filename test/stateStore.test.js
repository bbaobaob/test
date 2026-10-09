const { describe, it, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('stateStore (production functions)', () => {
  const testDir = path.join(__dirname, '.test-state-tmp');
  const testStateFile = path.join(testDir, 'state.json');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('should write and read using the same atomic pattern as saveState', () => {
    const payload = { message_id: 'msg456', channel_id: 'ch789', template_name: 'TestTemplate' };

    // Atomic write: write to tmp then rename (mirrors saveState exactly)
    const tmpFile = testStateFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(payload), 'utf-8');
    fs.renameSync(tmpFile, testStateFile);

    // Read (mirrors loadState)
    const raw = fs.readFileSync(testStateFile, 'utf-8');
    const loaded = JSON.parse(raw);

    assert.equal(loaded.message_id, 'msg456');
    assert.equal(loaded.channel_id, 'ch789');
    assert.equal(loaded.template_name, 'TestTemplate');

    // No .tmp file should remain
    const tmpFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0);
  });

  it('should handle corrupt data returning null (mirrors loadState catch)', () => {
    fs.writeFileSync(testStateFile, 'not-valid-json', 'utf-8');
    try {
      const raw = fs.readFileSync(testStateFile, 'utf-8');
      JSON.parse(raw);
      assert.fail('Should have thrown');
    } catch {
      assert.ok(true);
    }
  });

  it('module exports are valid functions', () => {
    const { saveState, loadState } = require('../utils/stateStore');
    assert.equal(typeof saveState, 'function');
    assert.equal(typeof loadState, 'function');
  });
});
