const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const logger = require('../config/logger');
const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.join(__dirname, '..', 'data', 'changelog.json');

const NUM_EMOJI = ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];

async function buildBadge(client) {
  const appEmojis = await client.application?.emojis?.fetch();
  const parts = [];
  for (let i = 0; i <= 5; i++) {
    const emoji = appEmojis?.find(e => e.name === `changelog_${i}`);
    parts.push(emoji ? emoji.toString() : '▪️');
  }
  return parts.join('');
}

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('Show the update history of each bot version.'),

  async execute(interaction, { client }) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf-8'));
    } catch (err) {
      logger.error(`Đọc changelog thất bại: ${err.message}`);
      return interaction.editReply('Could not load the changelog file.');
    }

    const entries = data.entries || [];
    if (!entries.length) {
      return interaction.editReply('No changelog entries found.');
    }

    const page = 0;

    // Cache badge on client so button handler can reuse it
    if (!client._changelogBadge) {
      client._changelogBadge = await buildBadge(client);
    }

    const embed = buildEmbed(entries, page, client._changelogBadge);
    const row = buildRow(entries, page);

    await interaction.editReply({ embeds: [embed], components: row ? [row] : [] });
  },
};

module.exports.buildEmbed = buildEmbed;
module.exports.buildRow = buildRow;
module.exports.buildBadge = buildBadge;

function pageEmoji(idx, total) {
  const i = Math.min(idx, NUM_EMOJI.length - 1);
  const t = Math.min(total, NUM_EMOJI.length - 1);
  return `${NUM_EMOJI[i]}/${NUM_EMOJI[t]}`;
}

function buildEmbed(entries, page, badge) {
  const e = entries[page];
  const lines = (e.changes || []).map(c => `<a:Done:1528654277541761135> ${c}`).join('\n');
  const desc = badge ? `${badge}\n\n${lines || '*(no notes)*'}` : (lines || '*(no notes)*');
  return new EmbedBuilder()
    .setTitle(`v${e.version}${page === 0 ? '  ✨' : ''}`)
    .setColor(page === 0 ? 0x57F287 : 0x57B5F2)
    .setDescription(desc)
    .setTimestamp(e.date ? new Date(e.date).getTime() : Date.now())
    .setFooter({ text: `${pageEmoji(page + 1, entries.length)}  ·  Bot v${BOT_VERSION}` });
}

function buildRow(entries, page) {
  if (entries.length <= 1) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`changelog:prev:${page}`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`changelog:next:${page}`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === entries.length - 1)
  );
}
