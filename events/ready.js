const { REST, Routes, ActivityType } = require('discord.js');
const { TOKEN, GUILD_ID, ENABLE_LIVE_MEMBER_CACHE, MEMBER_CACHE_TTL, STATS_PRUNE_AFTER } = require('../config/config');
const logger = require('../config/logger');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.info(`Đã đăng nhập với ${client.user.tag} (ID: ${client.user.id})`);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      logger.error(`GUILD_ID ${GUILD_ID} không tìm thấy — bot không thể hoạt động.`);
      return;
    }
    logger.info(`Đang phục vụ: ${guild.name} (ID: ${guild.id})`);
    client._guildObj = guild;

    await client._restoreState();

    if (ENABLE_LIVE_MEMBER_CACHE) {
      await client._refreshMemberCache();
    }

    // Initialize Discord logger now that guild is available
    client._dlog.init();

    if (client._commandList.length) {
      try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, GUILD_ID),
          { body: client._commandList.map(cmd => cmd.data.toJSON()) }
        );
        logger.info(`Đã đăng ký ${client._commandList.length} lệnh guild.`);
      } catch (err) {
        logger.error(`Đăng ký lệnh thất bại: ${err.message}`);
      }
    }

    client.user.setPresence({
      activities: [{
        name: '🔗 https://puddin707.github.io/weapon-ball-z-builds/',
        type: ActivityType.Listening,
      }],
      status: 'online',
    });
    logger.info('Presence set to Listening 🔗 weapon-ball-z-builds');

    client._startBackgroundTasks();
  }
};
