const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { LOG_CHANNEL_ID } = require('../config/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('testlog')
    .setDescription('[Admin] Send a test message to the Discord log channel.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction, { client }) {
    if (!LOG_CHANNEL_ID) {
      return interaction.editReply('LOG_CHANNEL_ID is not configured. Set it in `.env` first.');
    }

    const dlog = client._dlog;
    if (!dlog || !dlog._channel) {
      return interaction.editReply(`DiscordLogger is not initialized. Check LOG_CHANNEL_ID \`${LOG_CHANNEL_ID}\` exists and bot has access.`);
    }

    dlog.send(
      '🧪 Test Log',
      `This is a test message from **${interaction.user.tag}**.\nBot version \`${require('../config/config').BOT_VERSION}\` · ${new Date().toISOString()}`,
      0x57B5F2,
      [
        { name: 'Command', value: '`/testlog`', inline: true },
        { name: 'User', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
      ]
    );

    await interaction.editReply(`✅ Test log sent to <#${LOG_CHANNEL_ID}>.`);
  }
};
