const { ENABLE_LIVE_MEMBER_CACHE, MEMBER_CACHE_TTL } = require('../config/config');
const logger = require('../config/logger');

module.exports = {
  name: 'memberCacheRefresh',
  interval: MEMBER_CACHE_TTL * 1000,
  execute(client) {
    if (!ENABLE_LIVE_MEMBER_CACHE) return;
    if (client._memberCacheRefreshing) return;
    client._memberCacheRefreshing = true;
    client._refreshMemberCache().catch(err => {
      logger.error(`Làm mới cache thành viên thất bại: ${err.message}`);
    }).finally(() => {
      client._memberCacheRefreshing = false;
    });
  }
};
