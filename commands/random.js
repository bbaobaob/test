const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const { safeMarkdownField, joinLimited } = require('../utils/text');
const logger = require('../config/logger');

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('random')
    .setDescription('Randomly pick N people from a list.')
    .addStringOption(opt =>
      opt.setName('list')
        .setDescription('List of names separated by commas or spaces.')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('count')
        .setDescription('Number of people to pick (default: 1).')
        .setMinValue(1)
    ),

  async execute(interaction) {
    const raw = interaction.options.getString('list');
    const count = interaction.options.getInteger('count') || 1;

    const items = raw
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean);

    if (items.length < 2) {
      return interaction.editReply('Please provide at least 2 names.');
    }

    const pick = Math.min(count, items.length);

    const shuffled = [...items].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, pick);

    logger.info(`Random: picked ${pick} from ${items.length} items (requested by ${interaction.user.tag})`);

    const embed = new EmbedBuilder()
      .setTitle('🎲 Random Pick')
      .setColor(0x9B59B6)
      .addFields(
        { name: 'Pool', value: joinLimited(items.map(n => `\`${safeMarkdownField(n, 80)}\``), ', ', 1024), inline: false },
        { name: 'Selected', value: joinLimited(selected.map(n => `• **${safeMarkdownField(n, 80)}**`), '\n', 1024), inline: false }
      )
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
