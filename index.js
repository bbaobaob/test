const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const config = require('./config/config');
const logger = require('./config/logger');
const BotMetrics = require('./utils/metrics');
const RoleTemplateLoader = require('./utils/roleTemplate');
const RoleManager = require('./utils/roleManager');
const StatsDB = require('./utils/statsDb');
const { loadState, saveState } = require('./utils/stateStore');
const PickerManager = require('./utils/pickerManager');
const RoleBatcher = require('./utils/roleBatcher');
const DiscordLogger = require('./utils/discordLogger');
const { handleButton } = require('./handlers/buttonHandler');
const { buildPickerComponents } = require('./handlers/componentBuilder');
const cooldownCleanup = require('./tasks/cooldownCleanup');
const memberCacheRefresh = require('./tasks/memberCacheRefresh');
const statsPrune = require('./tasks/statsPrune');

// Guard against EPIPE (broken stdout pipe, e.g. when the npm wrapper or a
// parent process closes the stream). Without this, a single EPIPE during
// logging would throw an uncaught exception and kill the 24/7 bot.
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') return;
  logger.error(`Lỗi stdout: ${err.message}`);
});
process.stderr.on('error', (err) => {
  if (err && err.code === 'EPIPE') return;
});

if (!config.TOKEN) {
  console.error('MISSING ENV: DISCORD_TOKEN — Set DISCORD_TOKEN in .env or export it.');
  process.exit(1);
}
if (!config.GUILD_ID) {
  console.error('MISSING ENV: GUILD_ID — Set GUILD_ID in .env or export it.');
  process.exit(1);
}
if (!config.CHANNEL_ID) {
  console.error('MISSING ENV: CHANNEL_ID — Set CHANNEL_ID in .env or export it.');
  process.exit(1);
}

const intents = [GatewayIntentBits.Guilds];
if (config.ENABLE_MEMBER_INTENT || config.ENABLE_LIVE_MEMBER_CACHE) {
  intents.push(GatewayIntentBits.GuildMembers);
}

const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  allowedMentions: { parse: [] },
  presence: { status: 'online' },
});

client._startTime = Date.now();
client._stats = new StatsDB();
client._template = new RoleTemplateLoader(config.TEMPLATE_FILE);
client._dlog = new DiscordLogger(client);
client._roleManager = new RoleManager(client._stats, client._dlog);
client._metrics = new BotMetrics();
client._cooldowns = new Map();
client._guildObj = null;
client._memberCountCache = {};
client._memberCacheTs = 0;
client._pickerManager = new PickerManager();
client._roleBatcher = new RoleBatcher(config.BATCH_DEBOUNCE_MS);
client._state = loadState();

// ── Command loading ──────────────────────────────────────
client._commands = new Collection();
client._commandList = [];

const commandsDir = path.join(__dirname, 'commands');
for (const f of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, f));
  client._commands.set(cmd.data.name, cmd);
  client._commandList.push(cmd);
}
logger.info(`Đã tải ${client._commands.size} lệnh.`);

// ── Event loading ────────────────────────────────────────
const eventsDir = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'));
for (const f of eventFiles) {
  const evt = require(path.join(eventsDir, f));
  const runEvent = (...args) => {
    Promise.resolve(evt.execute(...args, client)).catch((err) => {
      const code = err && err.code;
      if (code === 10062 || code === 40060) return;
      logger.error(`Lỗi sự kiện ${evt.name}: ${err.stack || err.message}`);
    });
  };
  if (evt.once) {
    client.once(evt.name, runEvent);
  } else {
    client.on(evt.name, runEvent);
  }
}
logger.info(`Đã tải ${eventFiles.length} trình xử lý sự kiện.`);

// ── State restoration ────────────────────────────────────
client._restoreState = async function () {
  const state = this._state;
  if (!state) {
    logger.info('Chưa có trạng thái — dùng /deploy để tạo bảng role.');
    return;
  }

  try {
    this._template.load(this._guildObj);
  } catch (err) {
    logger.error(`Không thể tải template khi khởi động: ${err.message}`);
    return;
  }

  // NOTE: member cache refresh is NOT done here — the ready event calls
  // _refreshMemberCache() right after _restoreState() returns.

  logger.info('PublicPanelView sẵn sàng (custom_id=panel:open_picker).');

  if (this._dlog) {
    this._dlog.send('🔄 Bot Online', `State restored — panel tracking message \`${state.message_id || '(none)'}\` in <#${state.channel_id || 'unknown'}>.`, 0x57B5F2);
  }

  const channel = this._guildObj.channels.cache.get(state.channel_id);
  if (!channel) {
    logger.error(`Không tìm thấy kênh đã lưu ID ${state.channel_id}.`);
    return;
  }

  const msgId = state.message_id;
  if (msgId) {
    try {
      await channel.messages.fetch(msgId);
      logger.info(`Tin nhắn bảng ${msgId} đã xác nhận.`);
    } catch {
      logger.error(`Tin nhắn bảng ${msgId} đã mất. Chạy /deploy để tạo lại.`);
    }
  }
};

// ── Deploy message ───────────────────────────────────────
client._deployMessage = async function (guild) {
  this._template.load(guild);

  const warnings = [];
  const botMember = guild.members.me;
  if (botMember) {
    const botTop = botMember.roles.highest.position;
    for (const entry of this._template.roles) {
      const r = guild.roles.cache.get(entry.id);
      if (r && r.position >= botTop) {
        const w = `Role '${r.name}' (position ${r.position}) is at or above bot's top role (position ${botTop}). Bot may not be able to assign it.`;
        logger.warn(w);
        warnings.push(w);
      }
    }
  }

  const channel = guild.channels.cache.get(config.CHANNEL_ID);
  if (!channel) {
    throw new Error(`CHANNEL_ID ${config.CHANNEL_ID} not found in guild.`);
  }

  const openButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:open_picker')
      .setLabel('Pick Your Role')
      .setStyle(ButtonStyle.Primary)
  );

  const embed = this._template.buildPublicEmbed();
  const state = this._state;
  let message = null;

  if (state && state.message_id) {
    try {
      message = await channel.messages.fetch(state.message_id);
      await message.edit({ embeds: [embed], components: [openButton] });
      logger.info(`Đã cập nhật tin nhắn bảng ${message.id}.`);
    } catch {
      message = null;
    }
  }

  if (!message) {
    message = await channel.send({ embeds: [embed], components: [openButton] });
    logger.info(`Đã tạo tin nhắn bảng mới ${message.id}.`);
  }

  if (config.ENABLE_LIVE_MEMBER_CACHE) {
    await this._refreshMemberCache();
  }

  this._state = { message_id: message.id, channel_id: channel.id, template_name: this._template.templateName };
  if (!saveState(message.id, channel.id, this._template.templateName)) {
    throw new Error('Panel deployed but failed to persist state.json. Check filesystem permissions/free space.');
  }

  if (this._dlog) {
    this._dlog.send(
      '📋 Panel Deployed',
      `Role panel deployed in <#${channel.id}>.\n**Roles:** ${this._template.roles.length}  **Message:** \`${message.id}\``,
      0x57F287,
      warnings.length ? [{ name: '⚠️ Warnings', value: warnings.join('\n').slice(0, 1024), inline: false }] : []
    );
  }

  return { message, warnings };
};

// ── Member cache ─────────────────────────────────────────
client._refreshMemberCache = async function () {
  const guild = this._guildObj;
  if (!guild || !this._template.roles.length) return;
  if (config.ENABLE_MEMBER_INTENT) {
    try {
      await guild.members.fetch();
    } catch (err) {
      logger.warn(`Không thể fetch toàn bộ member cache; số liệu role có thể thiếu: ${err.message}`);
    }
  }
  const counts = {};
  for (const entry of this._template.roles) {
    const role = guild.roles.cache.get(entry.id);
    counts[entry.id] = role ? role.members.size : 0;
  }
  this._memberCountCache = counts;
  this._memberCacheTs = Date.now();
  logger.debug(`Đã làm mới cache thành viên — ${Object.keys(counts).length} role template, tổng ${Object.values(counts).reduce((a, b) => a + b, 0)} người giữ.`);
};

client._liveRoleCounts = async function (guild) {
  const age = Date.now() - this._memberCacheTs;
  if (!config.ENABLE_LIVE_MEMBER_CACHE) return {};
  if (age > config.MEMBER_CACHE_TTL * 1000 || !Object.keys(this._memberCountCache).length) {
    await this._refreshMemberCache();
  }
  return { ...this._memberCountCache };
};

client._liveRoleMembers = async function (guild, roleId) {
  if (!config.ENABLE_LIVE_MEMBER_CACHE) return [];
  const role = guild.roles.cache.get(roleId);
  if (!role) return [];
  return role.members.map(m => m.displayName).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
};

// ── Panel health check ────────────────────────────────────
client._checkPanelHealth = async function () {
  const state = this._state;
  if (!state || !state.message_id) return;
  const guild = this._guildObj;
  if (!guild) return;
  const channel = guild.channels.cache.get(state.channel_id);
  if (!channel) {
    logger.warn('Sức khỏe bảng: không tìm thấy kênh đã cấu hình.');
    return;
  }
  try {
    await channel.messages.fetch(state.message_id);
  } catch {
    logger.warn('Sức khỏe bảng: tin nhắn bảng đã mất. Chạy /deploy để tạo lại.');
  }
};

// ── Button handler ───────────────────────────────────────
client._handleButton = (interaction) => handleButton(interaction, client);

// ── Background tasks ─────────────────────────────────────
client._startBackgroundTasks = function () {
  // Cooldown cleanup every 60s
  const cdIid = setInterval(() => cooldownCleanup.execute(this), cooldownCleanup.interval);

  // Member cache refresh
  let mcIid = null;
  if (config.ENABLE_LIVE_MEMBER_CACHE) {
    mcIid = setInterval(() => memberCacheRefresh.execute(this), memberCacheRefresh.interval);
  }

  // Stats prune every 24h
  const spIid = setInterval(() => statsPrune.execute(this), statsPrune.interval);

  // Picker session GC every 60s
  const pkIid = setInterval(() => this._pickerManager.cleanupStale(), 60_000);

  // Panel message health check
  const phIid = setInterval(() => this._checkPanelHealth(), config.PANEL_CHECK_INTERVAL);

  this._intervalIds = [cdIid, mcIid, spIid, pkIid, phIid].filter(Boolean);
};

// ── Clean shutdown ───────────────────────────────────────
let shuttingDown = false;
async function withShutdownTimeout(promise, label) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      logger.warn(`${label} hết thời gian khi tắt.`);
      resolve();
    }, 5000);
  });
  await Promise.race([promise, timeout]);
  clearTimeout(timeoutId);
}

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} nhận được — đang tắt.`);
  // Clear background intervals first so they don't fire during teardown
  if (client._intervalIds) {
    for (const id of client._intervalIds) clearInterval(id);
    client._intervalIds = null;
  }
  // Flush any pending batched role writes before teardown (await so role
  // changes in the last debounce window aren't lost when we destroy the client).
  try { if (client._roleBatcher) await withShutdownTimeout(client._roleBatcher.flushAll(), 'RoleBatcher flush'); } catch (_) {}
  // Drain any pending Discord log entries
  try { await withShutdownTimeout(client._dlog._drain(), 'DiscordLogger drain'); } catch {}
  try { await withShutdownTimeout(client.destroy(), 'Discord client destroy'); } catch (err) { logger.error(`Hủy client thất bại: ${err.message}`); }
  try { client._stats.close(); } catch (err) { logger.error(`Đóng stats thất bại: ${err.message}`); }
  await withShutdownTimeout(logger.flush(), 'Logger flush').catch(() => {});
  process.exit(exitCode);
}

process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
process.on('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)); });
// EPIPE (broken stdout pipe) must never crash the bot — ignore it at the
// source so it can't reach uncaughtException and trigger a shutdown loop.
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EPIPE') return;
  // Avoid re-entrancy: logger.error writes to stdout which can itself EPIPE.
  try {
    const line = `UNCAUGHT EXCEPTION: ${err.stack || err.message}`;
    fs.appendFileSync(path.join(config.LOG_DIR, 'bot.log'), `${new Date().toISOString()} | FATAL | ${line}\n`);
  } catch (_) {}
  shutdown('uncaughtException', 1).catch(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  if (reason && reason.code === 'EPIPE') return;
  const code = reason && reason.code;
  if (code === 10062 || code === 40060 || code === 50013) {
    logger.warn(`Unhandled Discord interaction/API rejection ignored: ${reason.message || reason}`);
    return;
  }
  try {
    const line = `UNHANDLED REJECTION: ${reason?.stack || reason}`;
    fs.appendFileSync(path.join(config.LOG_DIR, 'bot.log'), `${new Date().toISOString()} | FATAL | ${line}\n`);
  } catch (_) {}
  logger.error(`Unhandled rejection: ${reason?.stack || reason}`);
});

// ── Login ────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════╗
║   💤  Zzz  v${config.BOT_VERSION.padEnd(18)}║
╚══════════════════════════════════════════════╝
  Guild  : ${config.GUILD_ID}
  Channel: ${config.CHANNEL_ID}
`);

client.login(config.TOKEN).catch(err => {
  logger.error(`Đăng nhập thất bại: ${err.message}`);
  process.exit(1);
});
