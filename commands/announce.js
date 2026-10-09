const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { BOT_VERSION, CHANNEL_ID } = require('../config/config');
const logger = require('../config/logger');
const { safeMarkdownField } = require('../utils/text');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('[Admin] Post a custom embed to the configured role-panel channel.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(opt => opt.setName('title').setDescription('Embed title (shown in bold at the top).').setRequired(true).setMaxLength(256))
    .addStringOption(opt => opt.setName('message').setDescription('Embed body text (markdown/mentions are escaped).').setRequired(true).setMaxLength(4096))
    .addStringOption(opt => opt.setName('color').setDescription('Hex color without #, e.g. FF5733 (default: 57B5F2).')),

  async execute(interaction, { guild }) {
    const title = interaction.options.getString('title');
    const message = interaction.options.getString('message');
    const colorStr = interaction.options.getString('color') || '57B5F2';

    const cleanColor = colorStr.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(cleanColor)) {
      return interaction.editReply('Invalid color. Use a 6-digit hex like `FF5733`.');
    }
    const colorInt = parseInt(cleanColor, 16);

    const channel = guild.channels.cache.get(CHANNEL_ID);
    if (!channel) {
      return interaction.editReply(`Target channel \`${CHANNEL_ID}\` not found in this server.`);
    }

    const embed = new EmbedBuilder()
      .setTitle(safeMarkdownField(title, 256))
      .setDescription(safeMarkdownField(message, 4096))
      .setColor(colorInt)
      .setTimestamp()
      .setFooter({ text: `Announced by ${interaction.user.displayName} | Bot v${BOT_VERSION}` });

    try {
      await channel.send({ embeds: [embed] });
      await interaction.editReply(`Announcement posted to <#${CHANNEL_ID}>.`);
    } catch (err) {
      logger.error(`Announce thất bại trong kênh ${CHANNEL_ID}: ${err.message}`);
      await interaction.editReply(`Failed to send announcement. Check bot permissions in <#${CHANNEL_ID}>.`);
    }
  }
};
