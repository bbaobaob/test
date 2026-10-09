const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const logger = require('../config/logger');

function getMessage(percent) {
  if (percent === 0) return 'straightest person';
  if (percent <= 25) return 'mf kinda straight';
  if (percent <= 50) return 'a little femboy';
  if (percent <= 75) return 'definitely not straight 🌈';
  if (percent <= 99) return 'more femine than a femboy';
  return 'gaymaxxing';
}

function getBar(percent) {
  const total = 13;
  const filled = Math.round((percent / 100) * total);
  return '🏳️‍🌈'.repeat(filled) + '🏳️'.repeat(total - filled);
}

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('gayrate')
    .setDescription('Measure the gayrate 🌈🌈🌈  of someone!')
    .addUserOption(opt =>
      opt.setName('user').setDescription('The user to check (default: yourself).')
    ),

  async execute(interaction, { client }) {
    const target = interaction.options.getUser('user') || interaction.user;
    const percent = target.id === '537734365833068561' ? 100 : Math.floor(Math.random() * 101);
    const bar = getBar(percent);
    const message = getMessage(percent);

    logger.info(`Gayrate: ${target.tag} = ${percent}% (requested by ${interaction.user.tag})`);

    const embed = new EmbedBuilder()
      .setTitle(`<:Gay:1528752000437714984> Gayrate Machine <:Gay:1528752000437714984>`)
      .setDescription(`${bar}\n**${percent}%** — ${message}`)
      .setColor(percent >= 75 ? 0xFF0000 : percent >= 50 ? 0xFFA500 : percent >= 25 ? 0xFFFF00 : 0x00FF00)
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp();

    if (target.id !== interaction.user.id) {
      embed.setAuthor({ name: target.displayName, iconURL: target.displayAvatarURL() });
    } else {
      embed.setAuthor({ name: 'Your Result' });
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
