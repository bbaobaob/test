const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const { getRandomWaifu } = require('../utils/waifuApi');
const logger = require('../config/logger');

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('rw')
    .setDescription('Pop a random anime image!')
    .addStringOption(opt =>
      opt.setName('gender')
        .setDescription('Filter by gender (default: any)')
        .addChoices(
          { name: '♀️ Female', value: 'female' },
          { name: '♂️ Male', value: 'male' },
          { name: '⚧️ Femboy', value: 'femboy' },
          { name: '⚧️ Tomboy', value: 'tomboy' },
        )
    ),

  async execute(interaction) {
    const gender = interaction.options.getString('gender');
    const { url } = await getRandomWaifu(gender);

    logger.info(`RW: đã pop waifu cho user ${interaction.user.id} (${interaction.user.tag})`);

    const embed = new EmbedBuilder()
      .setTitle('✨ Random Waifu')
      .setColor(0xFF69B4)
      .setImage(url)
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
