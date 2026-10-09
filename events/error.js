const logger = require('../config/logger');

module.exports = {
  name: 'error',
  execute(err) {
    // 10062 = Unknown interaction: the interaction token already expired
    // (3s window) or was already consumed. With optimistic UI / batched
    // role writes this is expected and benign — don't noise the logs.
    const code = err && err.code;
    if (code === 10062) return;
    const message = err && err.message ? err.message : String(err);
    logger.error(`Lỗi client: ${message}`);
  }
};
