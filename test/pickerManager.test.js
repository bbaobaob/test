const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const PickerManager = require('../utils/pickerManager');

describe('PickerManager', () => {
  let pm;

  beforeEach(() => {
    pm = new PickerManager();
  });

  it('should return null for unknown user', () => {
    assert.strictEqual(pm.get('unknown'), null);
  });

  it('should store and retrieve a session', () => {
    const session = { userId: '123', page: 1, createdAt: Date.now(), timeout: 90 };
    pm.set('123', session);
    assert.deepStrictEqual(pm.get('123'), session);
  });

  it('should delete a session', () => {
    pm.set('123', { userId: '123', page: 1, createdAt: Date.now(), timeout: 90 });
    pm.delete('123');
    assert.strictEqual(pm.get('123'), null);
  });

  it('should clean up stale sessions', () => {
    pm.set('old', { userId: 'old', page: 1, createdAt: Date.now() - 200_000, timeout: 90 });
    pm.set('fresh', { userId: 'fresh', page: 1, createdAt: Date.now(), timeout: 90 });
    pm.cleanupStale();
    assert.strictEqual(pm.get('old'), null);
    assert.ok(pm.get('fresh') !== null);
  });
});
