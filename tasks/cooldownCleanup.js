const { COOLDOWN_SECONDS, PUBLIC_COMMAND_COOLDOWN_SECONDS } = require('../config/config');
const logger = require('../config/logger');

module.exports = {
  name: 'cooldownCleanup',
  interval: 60_000,
  execute(client) {
    if (!client._cooldowns.size) return;
    // Use max(60s, 2×cooldown) so cooldown entries outlive the cooldown period
    const cutoff = Date.now() - Math.max(60_000, COOLDOWN_SECONDS * 2 * 1000);
    let count = 0;
    for (const [uid, ts] of client._cooldowns) {
      if (ts < cutoff) {
        client._cooldowns.delete(uid);
        count++;
      }
    }
    if (count) logger.debug(`Dọn cooldown: đã xóa ${count} mục hết hạn.`);

    if (client._publicCooldowns && client._publicCooldowns.size) {
      // Public cooldowns use their own TTL — size the cutoff off that constant.
      const publicCutoff = Date.now() - Math.max(60_000, PUBLIC_COMMAND_COOLDOWN_SECONDS * 10 * 1000);
      let publicCount = 0;
      for (const [key, ts] of client._publicCooldowns) {
        if (ts < publicCutoff) {
          client._publicCooldowns.delete(key);
          publicCount++;
        }
      }
      if (publicCount) logger.debug(`Dọn public cooldown: đã xóa ${publicCount} mục hết hạn.`);
    }
  }
};
