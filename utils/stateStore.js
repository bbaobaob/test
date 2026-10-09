const fs = require('fs');
const { STATE_FILE } = require('../config/config');
const logger = require('../config/logger');

function saveState(messageId, channelId, templateName) {
  const payload = { message_id: messageId, channel_id: channelId, template_name: templateName };
  try {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
    fs.renameSync(tmp, STATE_FILE);
    logger.info(`Đã lưu trạng thái: ${JSON.stringify(payload)}`);
    return true;
  } catch (err) {
    logger.error(`Lưu trạng thái thất bại: ${err.message}`);
    return false;
  }
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    logger.warn('File trạng thái bị hỏng — bắt đầu lại.');
    return null;
  }
}

module.exports = { saveState, loadState };
