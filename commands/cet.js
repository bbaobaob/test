const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const logger = require('../config/logger');

async function fetchCatImage() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('https://api.thecatapi.com/v1/images/search', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0]?.url || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('cet')
    .setDescription('Pop a random cat image!'),

  async execute(interaction) {
    const url = await fetchCatImage();

    logger.info(`CET: đã pop ảnh mèo cho user ${interaction.user.id} (${interaction.user.tag})`);

    const embed = new EmbedBuilder()
      .setTitle('🐱 Meow!')
      .setColor(0xF39C12)
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp();

    if (url) {
      embed.setImage(url);
    } else {
      embed.setDescription('Could not fetch a cat right now. Try again later.');
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
