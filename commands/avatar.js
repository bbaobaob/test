const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const logger = require('../config/logger');
const { safeMarkdownField } = require('../utils/text');

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("View a user's avatar in full size.")
    .addUserOption(opt =>
      opt.setName('user').setDescription('Whose avatar to view (default: yourself).')
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const url = target.displayAvatarURL({ size: 4096, extension: 'png' });

    logger.info(`Avatar: ${target.tag} (requested by ${interaction.user.tag})`);

    const embed = new EmbedBuilder()
      .setTitle(safeMarkdownField(`${target.displayName}'s Avatar`, 256))
      .setImage(url)
      .setColor(0x5865F2)
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
