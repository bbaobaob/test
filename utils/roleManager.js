const logger = require('../config/logger');

const RESOLVED = Promise.resolve();

class RoleManager {
  constructor(stats) {
    // Per-user lock chain: each user's lock is a promise that resolves
    // when their current operation finishes. New operations chain onto
    // the tail via prev.then(fn). This guarantees serialization: each
    // operation sees the results of all previous operations.
    this._locks = {};
    this._stats = stats;
    this._lockCount = 0;
  }

  /** Run fn() inside the per-user lock chain for userId. */
  async _runLocked(userId, fn) {
    // Atomically grab the previous tail and append a new one
    const prev = this._locks[userId] || RESOLVED;
    this._lockCount++;

    // Create the new tail: wait for previous to settle, then run fn
    const next = prev.then(fn, fn);
    // After fn finishes (success or error), we want the tail to be a
    // clean RESOLVED so future calls don't wait on the stale value.
    const settled = next.then(
      () => {
        this._lockCount--;
        if (this._locks[userId] === next) {
          delete this._locks[userId];
          this._lockCount--;
        }
      },
      () => {
        this._lockCount--;
        if (this._locks[userId] === next) {
          delete this._locks[userId];
          this._lockCount--;
        }
      }
    );
    // Don't keep settled in the chain — garbage-collect it
    this._locks[userId] = settled;

    return next;
  }

  async _retryRoleOp(fn, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (err.status && err.status >= 500 && attempt < maxRetries - 1) {
          const delay = 1000 * Math.pow(2, attempt);
          logger.warn(`HTTP ${err.status} on role op — retry ${attempt + 1}/${maxRetries} in ${delay}ms …`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  async assignRole(member, targetRole, templateRoleIds, guild) {
    return this._runLocked(member.id, async () => {
      const currentIds = new Set(member.roles.cache.map(r => r.id));
      const targetId = targetRole.id;
      const hasRole = currentIds.has(targetId);

      try {
        if (hasRole) {
          await this._retryRoleOp(() => member.roles.remove(targetRole, 'Role toggle — remove'));
        } else {
          await this._retryRoleOp(() => member.roles.add(targetRole, 'Role toggle — add'));
        }
      } catch (err) {
        if (err.status === 403) {
          throw new Error('I lack Manage Roles or the target role is above my highest role.');
        }
        throw err;
      }

      const action = hasRole ? 'removed' : 'added';
      logger.info(`USER=${member.id} (${member.displayName}) | ${action.toUpperCase()}=${targetRole.name}`);

      if (!hasRole) {
        try {
          this._stats.record(member.id, member.displayName, targetRole.name, []);
        } catch (statsErr) {
          logger.error(`Failed to record stats for user ${member.id}: ${statsErr.message}`);
        }
      }

      return { action, roleName: targetRole.name };
    });
  }

  async clearMemberRoles(member, templateRoleIds, guild, reason = 'Admin clear via /clearroles') {
    return this._runLocked(member.id, async () => {
      const currentIds = new Set(member.roles.cache.map(r => r.id));
      const toRemove = [];
      for (const rid of templateRoleIds) {
        if (currentIds.has(rid)) {
          const r = guild.roles.cache.get(rid);
          if (r) toRemove.push(r);
        }
      }
      if (toRemove.length) {
        try {
          await this._retryRoleOp(() => member.roles.remove(toRemove, reason));
        } catch (err) {
          if (err.status === 403) {
            throw new Error('I lack Manage Roles or a role is above my highest role.');
          }
          throw err;
        }
        logger.info(`CLEAR_ROLES: USER=${member.id} (${member.displayName}) | REMOVED=${JSON.stringify(toRemove.map(r => r.name))}`);
      }
      return toRemove;
    });
  }
}

module.exports = RoleManager;
