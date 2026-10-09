const logger = require('../config/logger');
const { safeMarkdownField } = require('./text');

const RESOLVED = Promise.resolve();

class RoleManager {
  constructor(stats, discordLogger) {
    // Per-user lock chain: each user's lock is a promise that resolves
    // when their current operation finishes. New operations chain onto
    // the tail via prev.then(fn). This guarantees serialization: each
    // operation sees the results of all previous operations.
    this._locks = {};
    this._stats = stats;
    this._dlog = discordLogger;
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
        if (this._locks[userId] === settled) {
          delete this._locks[userId];
        }
      },
      () => {
        this._lockCount--;
        if (this._locks[userId] === settled) {
          delete this._locks[userId];
        }
      }
    );
    this._locks[userId] = settled;

    return next;
  }

  async _retryRoleOp(fn, maxRetries = 4) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        // Rate limited (HTTP 429) or transient 5xx — both retryable.
        const status = err.status || err.code;
        const isRateLimit = status === 429;
        const isServerErr = err.status && err.status >= 500;
        if ((isRateLimit || isServerErr) && attempt < maxRetries - 1) {
          // Discord tells us exactly how long to wait via retry_after (seconds)
          // or X-RateLimit-Reset-After. Fall back to exponential backoff.
          let delay = 1000 * Math.pow(2, attempt);
          if (isRateLimit) {
            const retryAfter = err.retry_after ?? err.headers?.['retry-after'] ?? err.headers?.['x-ratelimit-reset-after'];
            if (retryAfter != null) delay = Math.max(0, Number(retryAfter) * 1000);
            else if (err.headers?.['x-ratelimit-reset-after'] != null) {
              delay = Math.max(0, Number(err.headers['x-ratelimit-reset-after']) * 1000);
            }
          }
          logger.warn(`${isRateLimit ? 'GIỚI HẠN TỐC ĐỘ (429)' : `HTTP ${err.status}`} trên thao tác role — thử lại ${attempt + 1}/${maxRetries} sau ${delay}ms …`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  async assignRole(member, targetRole, templateRoleIds, guild, opts = {}) {
    return this._runLocked(member.id, async () => {
      const currentIds = new Set(member.roles.cache.map(r => r.id));
      const targetId = targetRole.id;
      const hasRole = currentIds.has(targetId);
      const multi = opts.multi === true;

      try {
        if (hasRole) {
          await this._retryRoleOp(() => member.roles.remove(targetRole, 'Role toggle — remove'));
        } else {
          await this._retryRoleOp(() => member.roles.add(targetRole, 'Role toggle — add'));
          // In single-select mode, remove the other template roles so only one is held.
          if (!multi) {
            const others = templateRoleIds
              .map(id => guild.roles.cache.get(id))
              .filter(r => r && r.id !== targetId && member.roles.cache.has(r.id));
            for (const r of others) {
              await this._retryRoleOp(() => member.roles.remove(r, 'Single-select — remove previous'));
            }
          }
        }
      } catch (err) {
        if (err.status === 403) {
          throw new Error('I lack Manage Roles or the target role is above my highest role.');
        }
        throw err;
      }

      const action = hasRole ? 'removed' : 'added';
      logger.info(`USER=${member.id} (${member.displayName}) | ${action.toUpperCase()}=${targetRole.name}${multi ? ' [nhiều]' : ''}`);

      if (this._dlog) {
        this._dlog.send(
          action === 'added' ? '✅ Role Added' : '🗑️ Role Removed',
          `**${safeMarkdownField(member.displayName, 80)}** ${action === 'added' ? 'got' : 'lost'} **${safeMarkdownField(targetRole.name, 80)}**`,
          action === 'added' ? 0x57F287 : 0xE74C3C,
          [
            { name: 'User', value: `${member} (\`${member.id}\`)`, inline: true },
            { name: 'Role', value: `<@&${targetRole.id}>`, inline: true },
          ]
        );
      }

      try {
        this._stats.record(member.id, member.displayName, targetRole.name, [], action === 'added' ? 'add' : 'remove');
      } catch (statsErr) {
        logger.error(`Ghi stats cho user ${member.id} thất bại: ${statsErr.message}`);
      }

      return { action, roleName: targetRole.name };
    });
  }

  /**
   * Coalesced write: add and remove many roles in one locked operation.
   * Used by the RoleBatcher to turn rapid clicks into a single API round-trip.
   */
  async applyBatch(member, addIds, removeIds, guild, opts = {}) {
    return this._runLocked(member.id, async () => {
      const allowed = opts.allowedRoleIds ? new Set(opts.allowedRoleIds.map(String)) : null;
      const safeAddIds = addIds.map(String).filter(id => !allowed || allowed.has(id));
      const safeRemoveIds = removeIds.map(String).filter(id => !allowed || allowed.has(id));
      if (safeAddIds.length !== addIds.length || safeRemoveIds.length !== removeIds.length) {
        throw new Error('Refusing to modify a role that is not in the active picker template.');
      }

      let currentMember = member;
      try {
        currentMember = await guild.members.fetch(member.id);
      } catch (err) {
        logger.warn(`Không thể fetch member mới cho ${member.id}; dùng cache hiện tại: ${err.message}`);
      }
      const initialRoleIds = new Set(currentMember.roles.cache.map(r => r.id));

      const addRoles = safeAddIds.map(id => guild.roles.cache.get(id)).filter(Boolean);
      const removeRoles = safeRemoveIds.map(id => guild.roles.cache.get(id)).filter(Boolean);
      const multi = opts.multi === true;

      // Single-select: only the most recently requested role should remain.
      // (In a batch with multiple addIds, all of them would otherwise survive,
      // violating the single-select invariant.)
      let finalAddRoles = addRoles;
      if (addRoles.length && !multi && addRoles.length > 1) {
        finalAddRoles = [addRoles[addRoles.length - 1]];
      }

      try {
        if (finalAddRoles.length) {
          for (const r of finalAddRoles) {
            await this._retryRoleOp(() => currentMember.roles.add(r, 'Batch role add'));
          }
        }
        if (removeRoles.length) {
          for (const r of removeRoles) {
            await this._retryRoleOp(() => currentMember.roles.remove(r, 'Batch role remove'));
          }
        }
        // In single-select mode, adding roles also clears other template roles.
        if (finalAddRoles.length && !multi) {
          const templateRoleIds = opts.templateRoleIds || [];
          const others = templateRoleIds
            .map(id => guild.roles.cache.get(id))
            .filter(r => r && !finalAddRoles.some(a => a.id === r.id) && initialRoleIds.has(r.id));
          for (const r of others) {
            await this._retryRoleOp(() => currentMember.roles.remove(r, 'Single-select — remove previous'));
          }
        }
      } catch (err) {
        if (err.status === 403) {
          throw new Error('I lack Manage Roles or a target role is above my highest role.');
        }
        throw err;
      }

      const statEntries = [];
      for (const r of finalAddRoles) {
        logger.info(`USER=${member.id} (${member.displayName}) | BATCH THÊM=${r.name}${multi ? ' [nhiều]' : ''}`);
        statEntries.push({ userId: member.id, userName: member.displayName, roleName: r.name, removedNames: [], action: 'add' });
      }
      for (const r of removeRoles) {
        logger.info(`USER=${member.id} (${member.displayName}) | BATCH XÓA=${r.name}${multi ? ' [nhiều]' : ''}`);
        statEntries.push({ userId: member.id, userName: member.displayName, roleName: r.name, removedNames: [], action: 'remove' });
      }

      // Persist stats in one batched transaction (recordBatch does a single write).
      if (statEntries.length && this._stats && this._stats.recordBatch) {
        try { this._stats.recordBatch(statEntries); } catch (err) { logger.warn(`batch stats thất bại: ${err.message}`); }
      }

      return { added: finalAddRoles.map(r => r.name), removed: removeRoles.map(r => r.name) };
    });
  }

  async clearMemberRoles(member, templateRoleIds, guild, reason = 'Admin clear via /clearroles') {
    return this._runLocked(member.id, async () => {
      let currentMember = member;
      try {
        currentMember = await guild.members.fetch(member.id);
      } catch (err) {
        logger.warn(`Không thể fetch member mới cho clear ${member.id}; dùng cache hiện tại: ${err.message}`);
      }
      const currentIds = new Set(currentMember.roles.cache.map(r => r.id));
      const toRemove = [];
      for (const rid of templateRoleIds) {
        if (currentIds.has(rid)) {
          const r = guild.roles.cache.get(rid);
          if (r) toRemove.push(r);
        }
      }
      if (toRemove.length) {
        try {
          for (const r of toRemove) {
            await this._retryRoleOp(() => currentMember.roles.remove(r, reason));
          }
        } catch (err) {
          if (err.status === 403) {
            throw new Error('I lack Manage Roles or a role is above my highest role.');
          }
          throw err;
        }
        logger.info(`XÓA_ROLES: USER=${member.id} (${member.displayName}) | ĐÃ_XÓA=${JSON.stringify(toRemove.map(r => r.name))}`);
        if (this._stats && this._stats.recordBatch) {
          try {
            this._stats.recordBatch(toRemove.map(r => ({
              userId: member.id,
              userName: member.displayName,
              roleName: r.name,
              removedNames: [],
              action: 'clear',
            })));
          } catch (err) {
            logger.warn(`clear stats thất bại: ${err.message}`);
          }
        }
      }

      if (toRemove.length && this._dlog) {
        this._dlog.send(
          '🗑️ All Roles Removed',
          `**${safeMarkdownField(member.displayName, 80)}** had all template roles removed (${toRemove.length} total).`,
          0xE74C3C,
          [
            { name: 'User', value: `${member} (\`${member.id}\`)`, inline: true },
            { name: 'Roles Removed', value: toRemove.map(r => `<@&${r.id}>`).join(', ').slice(0, 1024) || '*(none)*', inline: false },
            { name: 'Reason', value: reason, inline: false },
          ]
        );
      }

      return toRemove;
    });
  }
}

module.exports = RoleManager;
