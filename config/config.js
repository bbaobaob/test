const path = require('path');
const dotenv = require('dotenv');

const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

function envBool(key, defaultVal = false) {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return defaultVal;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

const LOW_RAM_MODE = envBool('LOW_RAM_MODE', true);
const ENABLE_LIVE_MEMBER_CACHE = envBool('ENABLE_LIVE_MEMBER_CACHE', !LOW_RAM_MODE);
const ENABLE_MEMBER_INTENT = envBool('ENABLE_MEMBER_INTENT', !LOW_RAM_MODE) || ENABLE_LIVE_MEMBER_CACHE;

function resolveProjectPath(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
}

function parsePosInt(value, defaultVal) {
  const n = parseInt(value, 10);
  return (!isNaN(n) && n > 0) ? n : defaultVal;
}

function parsePosFloat(value, defaultVal) {
  const n = parseFloat(value);
  return (!isNaN(n) && n >= 0) ? n : defaultVal;
}

module.exports = {
  PROJECT_ROOT,
  DATA_DIR: path.join(PROJECT_ROOT, 'data'),
  LOG_DIR: path.join(PROJECT_ROOT, 'logs'),

  TOKEN: process.env.DISCORD_TOKEN,
  GUILD_ID: process.env.GUILD_ID,
  CHANNEL_ID: process.env.CHANNEL_ID,
  TEMPLATE_FILE: resolveProjectPath(process.env.TEMPLATE_FILE) || path.join(PROJECT_ROOT, 'data', 'roles_template.json'),
  STATE_FILE: path.join(PROJECT_ROOT, 'data', 'state.json'),
  STATS_DB_PATH: path.join(PROJECT_ROOT, 'data', 'stats.db'),

  BOT_VERSION: '1.0.4',
  BUTTONS_PER_PAGE: 20,

  LOW_RAM_MODE,
  ENABLE_MEMBER_INTENT,
  ENABLE_LIVE_MEMBER_CACHE,

  PICKER_TIMEOUT: parsePosInt(process.env.PICKER_TIMEOUT, LOW_RAM_MODE ? 90 : 180),
  COOLDOWN_SECONDS: parsePosFloat(process.env.COOLDOWN_SECONDS, LOW_RAM_MODE ? 1.0 : 1.0),
  PUBLIC_COMMAND_COOLDOWN_SECONDS: parsePosFloat(process.env.PUBLIC_COMMAND_COOLDOWN_SECONDS, LOW_RAM_MODE ? 3.0 : 2.0),
  BATCH_DEBOUNCE_MS: parsePosInt(process.env.BATCH_DEBOUNCE_MS, LOW_RAM_MODE ? 400 : 400),
  MEMBER_CACHE_TTL: parsePosInt(process.env.MEMBER_CACHE_TTL, LOW_RAM_MODE ? 3600 : 900),
  ROLE_LIST_MAX: parsePosInt(process.env.ROLE_LIST_MAX, LOW_RAM_MODE ? 20 : 40),
  STATS_PRUNE_AFTER: parsePosInt(process.env.STATS_PRUNE_AFTER, LOW_RAM_MODE ? 60 : 120),

  LOG_LEVEL: (process.env.LOG_LEVEL || 'info').toLowerCase(),

  PANEL_CHECK_INTERVAL: parsePosInt(process.env.PANEL_CHECK_INTERVAL, 3600000),

  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || null,
};
