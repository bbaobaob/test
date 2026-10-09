const logger = require('../config/logger');

/**
 * RoleBatcher — coalesces rapid per-user role toggles into a single Discord
 * API round-trip. Instead of one `member.roles.add/remove` call per click,
 * intents accumulate for BATCH_DEBOUNCE_MS and then flush once via the
 * caller-supplied flushFn(addIds, removeIds).
 *
 * Adding and removing the same role within the window cancels out.
 */
class RoleBatcher {
  constructor(debounceMs = 400) {
    this._debounceMs = debounceMs;
    this._pending = new Map(); // userId -> { desired:Map<roleId,'add'|'remove'>, timer, flushFn, flushPromise }
  }

  /**
   * @param {string} userId
   * @param {{add?:string|null, remove?:string|null}} intent
   * @param {(addIds:string[], removeIds:string[]) => Promise<void>} flushFn
   * @returns {Promise<void>} resolves/rejects with the eventual batched flush
   *   so callers can react (e.g. revert optimistic UI on failure).
   */
  enqueue(userId, intent, flushFn) {
    let entry = this._pending.get(userId);
    if (!entry) {
      entry = { desired: new Map(), timer: null, flushFn, _resolve: null, _reject: null, flushPromise: null };
      this._pending.set(userId, entry);
    } else {
      entry.flushFn = flushFn; // keep latest flush implementation
    }

    // Track the desired end-state per role id (last intent wins). This avoids
    // the old "add always wins" behaviour where a rapid add-then-remove inside
    // the debounce window was coalesced into a permanent add.
    if (intent.add) entry.desired.set(String(intent.add), 'add');
    if (intent.remove) entry.desired.set(String(intent.remove), 'remove');

    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this._flush(userId), this._debounceMs);

    // Share one settlement promise across all enqueues in the same window.
    if (!entry.flushPromise) {
      entry.flushPromise = new Promise((resolve, reject) => {
        entry._resolve = resolve;
        entry._reject = reject;
      });
    }
    return entry.flushPromise;
  }

  /** Force an immediate flush for a user (e.g. on picker close). */
  flushNow(userId) {
    const entry = this._pending.get(userId);
    if (!entry) return Promise.resolve();
    if (entry.timer) clearTimeout(entry.timer);
    return this._flush(userId);
  }

  /** Flush all pending users (used on shutdown). */
  flushAll() {
    return Promise.all([...this._pending.keys()].map((u) => this.flushNow(u)));
  }

  _flush(userId) {
    const entry = this._pending.get(userId);
    if (!entry) return Promise.resolve();
    this._pending.delete(userId);

    const addIds = [];
    const removeIds = [];
    for (const [rid, action] of entry.desired) {
      if (action === 'add') addIds.push(rid);
      else removeIds.push(rid);
    }

    if (!addIds.length && !removeIds.length) {
      if (entry._resolve) entry._resolve();
      return Promise.resolve();
    }

    const fn = entry.flushFn;
    return Promise.resolve()
      .then(() => fn(addIds, removeIds))
      .then(() => { if (entry._resolve) entry._resolve(); })
      .catch((err) => {
        logger.error(`RoleBatcher flush thất bại (user ${userId}): ${err.stack || err.message}`);
        if (entry._reject) entry._reject(err);
      });
  }
}

module.exports = RoleBatcher;
