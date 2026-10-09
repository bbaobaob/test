const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const BotMetrics = require('../utils/metrics');

describe('BotMetrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new BotMetrics();
  });

  it('should start with zero counts', () => {
    assert.equal(metrics.totalCommands, 0);
    assert.equal(metrics.totalErrors, 0);
    assert.equal(metrics.avgLatencyMs, 0);
  });

  it('should increment command count', () => {
    metrics.incr('deploy');
    assert.equal(metrics.totalCommands, 1);
    assert.deepStrictEqual(metrics.summary().commands, { deploy: 1 });
  });

  it('should increment error count', () => {
    metrics.error('status');
    assert.equal(metrics.totalErrors, 1);
  });

  it('should track timing', () => {
    metrics.recordTiming(0.5);
    metrics.recordTiming(1.5);
    assert.equal(metrics.avgLatencyMs, 1000);
  });

  it('should return a summary snapshot', () => {
    metrics.incr('ping');
    metrics.error('ping');
    metrics.recordTiming(0.25);
    const s = metrics.summary();
    assert.ok(typeof s.avgLatencyMs === 'number');
    assert.ok(s.totalCmds >= 0);
    assert.ok(s.totalErrs >= 0);
  });
});
