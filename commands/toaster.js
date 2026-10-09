const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const { getRandomImage } = require('../utils/toasterApi');
const logger = require('../config/logger');

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('toaster')
    .setDescription('Pop a fresh toast image from the toaster!'),

  async execute(interaction) {
    const { url, credit } = await getRandomImage();

    logger.info(`Toaster: đã pop ảnh cho user ${interaction.user.id} (${interaction.user.tag})`);

    const embed = new EmbedBuilder()
      .setTitle('🍞 Fresh Toast from the Oven!')
      .setColor(0xD4A574)
      .setImage(url)
      .setFooter({ text: `${credit} | Bot v${BOT_VERSION}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
