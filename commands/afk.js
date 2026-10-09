const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const { safeMarkdownField } = require('../utils/text');
const logger = require('../config/logger');

const AFK_PREFIX = '[AFK]';

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Toggle AFK mode — adds/removes [AFK] prefix from your nickname.')
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Reason for going AFK.')
    ),

  async execute(interaction, { guild }) {
    const member = interaction.member;
    const reason = interaction.options.getString('reason') || 'AFK';
    const currentNick = member.displayName;

    const isAfk = currentNick.startsWith(AFK_PREFIX);

    if (isAfk) {
      const original = currentNick.slice(AFK_PREFIX.length).trim();
      try {
        await member.setNickname(original || null);
      } catch {
        return interaction.editReply('I don\'t have permission to change your nickname. Make sure I have **Manage Nicknames** permission.');
      }
      logger.info(`AFK: ${interaction.user.tag} is back (nickname restored)`);

      const embed = new EmbedBuilder()
        .setTitle('👋 Welcome Back!')
        .setDescription(`Removed **${AFK_PREFIX}** from your nickname.`)
        .setColor(0x2ECC71)
        .setFooter({ text: `Bot v${BOT_VERSION}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    const newNick = `${AFK_PREFIX} ${currentNick.slice(0, 28)}`;
    try {
      await member.setNickname(newNick);
    } catch {
      return interaction.editReply('I don\'t have permission to change your nickname. Make sure I have **Manage Nicknames** permission.');
    }

    logger.info(`AFK: ${interaction.user.tag} went AFK (reason: ${reason})`);

    const embed = new EmbedBuilder()
      .setTitle('💤 AFK')
      .setDescription(`Set your nickname to **${safeMarkdownField(newNick, 80)}**\nReason: *${safeMarkdownField(reason, 200)}*`)
      .setColor(0x95A5A6)
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
