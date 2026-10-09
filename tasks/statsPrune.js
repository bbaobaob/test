const { STATS_PRUNE_AFTER } = require('../config/config');
const logger = require('../config/logger');

module.exports = {
  name: 'statsPrune',
  interval: 86_400_000,
  execute(client) {
    try {
      client._stats.prune(STATS_PRUNE_AFTER);
    } catch (err) {
      logger.error(`Dọn stats thất bại: ${err.message}`);
    }
  }
};
