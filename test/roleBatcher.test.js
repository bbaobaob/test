// test/roleBatcher.test.js — RoleBatcher coalescing + settlement behavior.
//
// The batcher turns rapid per-user role toggles into a single flush, and
// exposes one settlement promise per debounce window so callers can react
// (e.g. revert optimistic UI on failure).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const RoleBatcher = require('../utils/roleBatcher');

describe('RoleBatcher', () => {
  it('last intent wins for the same role inside one debounce window', async () => {
    const batcher = new RoleBatcher(50);
    const calls = [];
    const flushFn = async (addIds, removeIds) => {
      calls.push({ add: [...addIds], remove: [...removeIds] });
    };

    // Rapid add then remove of the same role within the debounce window:
    // the last intent wins (matches the optimistic session-ownedRoleIds
    // toggle in the picker UI).
    batcher.enqueue('u1', { add: 'r1', remove: null }, flushFn);
    batcher.enqueue('u1', { add: null, remove: 'r1' }, flushFn);

    // The window should not have flushed yet — let the timer fire.
    await new Promise((r) => setTimeout(r, 120));

    assert.strictEqual(calls.length, 1, 'should flush exactly once');
    assert.deepStrictEqual(calls[0], { add: [], remove: ['r1'] }, 'last intent (remove) wins');
  });

  it('shares one settlement promise across enqueues in the same window', async () => {
    const batcher = new RoleBatcher(50);
    const flushFn = async () => {};
    const p1 = batcher.enqueue('u1', { add: 'r1', remove: null }, flushFn);
    const p2 = batcher.enqueue('u1', { add: 'r2', remove: null }, flushFn);
    assert.strictEqual(p1, p2, 'enqueues in the same window share the same promise');

    await Promise.all([p1, p2]);
    await new Promise((r) => setTimeout(r, 120));
  });

  it('rejects the shared promise when the flushFn throws', async () => {
    const batcher = new RoleBatcher(50);
    const flushFn = async () => { throw new Error('boom'); };
    const p = batcher.enqueue('u1', { add: 'r1', remove: null }, flushFn);

    await assert.rejects(p, /boom/, 'settlement promise should reject on flush failure');
    await new Promise((r) => setTimeout(r, 120));
  });

  it('flushNow flushes immediately and clears the pending entry', async () => {
    const batcher = new RoleBatcher(1000);
    const calls = [];
    const flushFn = async (addIds, removeIds) => { calls.push({ add: [...addIds], remove: [...removeIds] }); };

    batcher.enqueue('u1', { add: 'r1', remove: null }, flushFn);
    await batcher.flushNow('u1');

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], { add: ['r1'], remove: [] });
  });

  it('flushAll flushes every pending user', async () => {
    const batcher = new RoleBatcher(1000);
    const calls = [];
    const flushFn = async (addIds, removeIds) => { calls.push({ add: [...addIds], remove: [...removeIds] }); };

    batcher.enqueue('u1', { add: 'r1', remove: null }, flushFn);
    batcher.enqueue('u2', { add: 'r2', remove: null }, flushFn);
    await batcher.flushAll();

    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0], { add: ['r1'], remove: [] });
    assert.deepStrictEqual(calls[1], { add: ['r2'], remove: [] });
  });
});