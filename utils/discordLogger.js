const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const logger = require('../config/logger');
const { truncate, safeField } = require('./text');

/**
 * DiscordLogger — sends bot activity logs as embeds to a configurable Discord channel.
 * Uses a single linear queue to avoid rate limiting (no batching needed for <1 msg/sec).
 */
class DiscordLogger {
  constructor(client) {
    this._client = client;
    this._queue = [];
    this._draining = false;
    this._channel = null;
    this._maxQueue = 100;
  }

  /** Called once after guild is ready — fetch/cache the log channel */
  init() {
    if (!config.LOG_CHANNEL_ID) {
      logger.debug('LOG_CHANNEL_ID chưa được đặt — Discord logging đã tắt.');
      return;
    }
    const guild = this._client._guildObj;
    if (!guild) return;
    const channel = guild.channels.cache.get(config.LOG_CHANNEL_ID);
    if (!channel) {
      logger.warn(`DiscordLogger: LOG_CHANNEL_ID ${config.LOG_CHANNEL_ID} không tìm thấy trong guild.`);
      return;
    }
    this._channel = channel;
    logger.info(`DiscordLogger: đang log tới #${channel.name} (${channel.id}).`);
  }

  /** Enqueue a discord log entry */
  send(title, description, color = 0x57B5F2, fields = []) {
    if (!this._channel) return;
    const embed = new EmbedBuilder()
      .setTitle(truncate(title, 256))
      .setDescription(safeField(description, 4096))
      .setColor(color)
      .setTimestamp();
    if (fields.length) {
      embed.addFields(fields.slice(0, 25).map(f => ({
        name: truncate(f.name, 256),
        value: safeField(f.value, 1024),
        inline: Boolean(f.inline),
      })));
    }
    if (this._queue.length >= this._maxQueue) {
      this._queue.shift();
      logger.warn('DiscordLogger: queue đầy, đã bỏ log cũ nhất.');
    }
    this._queue.push(embed);
    if (!this._draining) this._drain();
  }

  async _drain() {
    this._draining = true;
    while (this._queue.length) {
      const embed = this._queue.shift();
      embed._sendAttempts = embed._sendAttempts || 0;
      try {
        await this._channel.send({ embeds: [embed] });
        // Small gap between sends to stay under global rate limit
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        // If channel was deleted or permissions changed, disable
        if (err.status === 403 || err.status === 404 || (err.code && err.code === 10003)) {
          logger.warn(`DiscordLogger: không thể gửi tới kênh log — ${err.message}. Đang tắt.`);
          this._channel = null;
          this._queue = [];
          break;
        }
        embed._sendAttempts++;
        logger.warn(`DiscordLogger: gửi thất bại (${embed._sendAttempts}/3): ${err.message}`);
        if (embed._sendAttempts < 3) {
          this._queue.unshift(embed);
          await new Promise(r => setTimeout(r, 5000));
        } else {
          logger.warn('DiscordLogger: bỏ log sau 3 lần gửi thất bại.');
        }
      }
    }
    this._draining = false;
  }
}

module.exports = DiscordLogger;
