const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const logger = require('../config/logger');

function getMessage(percent) {
  if (percent === 0) return 'no aura — touch grass';
  if (percent <= 10) return 'bruh your aura is dead';
  if (percent <= 25) return 'kinda dull ngl';
  if (percent <= 40) return 'mid aura at best';
  if (percent <= 55) return 'not bad, not great';
  if (percent <= 70) return 'pretty solid aura';
  if (percent <= 85) return 'aura is shining ✨';
  if (percent <= 99) return 'absolute aura farming';
  return 'MAX AURA — YOU HIM';
}

function getBar(percent) {
  const total = 13;
  const filled = Math.round((percent / 100) * total);
  return '✨'.repeat(filled) + '💤'.repeat(total - filled);
}

const GIF_TAGS = ['slap', 'kill', 'kick', 'bully', 'bonk', 'yeet', 'dance', 'highfive'];
const IMG_TAGS = ['husbando', 'kitsune'];

async function fetchAnimeGif() {
  const tags = [...GIF_TAGS.sort(() => Math.random() - 0.5), ...IMG_TAGS.sort(() => Math.random() - 0.5)];
  for (const tag of tags) {
    try {
      const url = tag === 'husbando' || tag === 'kitsune'
        ? `https://nekos.best/api/v2/${tag}`
        : `https://api.waifu.pics/sfw/${tag}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const data = await res.json();
      const imgUrl = data?.results?.[0]?.url || data?.url;
      if (imgUrl) return imgUrl;
    } catch {}
  }
  return null;
}

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('aura')
    .setDescription('Check your aura level ✨')
    .addUserOption(opt =>
      opt.setName('user').setDescription('The user to check (default: yourself).')
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const percent = Math.floor(Math.random() * 101);
    const bar = getBar(percent);
    const message = getMessage(percent);

    logger.info(`Aura: ${target.tag} = ${percent}% (requested by ${interaction.user.tag})`);

    const embed = new EmbedBuilder()
      .setTitle('✨ Aura Check ✨')
      .setDescription(`${bar}\n**${percent}%** — ${message}`)
      .setColor(percent >= 80 ? 0x9B59B6 : percent >= 50 ? 0x3498DB : percent >= 25 ? 0x2ECC71 : 0x95A5A6)
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp();

    if (target.id !== interaction.user.id) {
      embed.setAuthor({ name: target.displayName, iconURL: target.displayAvatarURL() });
    } else {
      embed.setAuthor({ name: 'Your Aura' });
    }

    const gifUrl = await fetchAnimeGif();
    if (gifUrl) {
      embed.setImage(gifUrl);
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
