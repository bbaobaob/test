const fs = require('fs/promises');
const path = require('path');
const { randomInt } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION, PROJECT_ROOT } = require('../config/config');
const logger = require('../config/logger');

const ASSET_DIR = path.join(PROJECT_ROOT, 'assets', 'coinflip');
const GIF_ASSET = path.join(ASSET_DIR, 'coinflip.gif');
const RESULT_ASSETS = {
  heads: path.join(ASSET_DIR, 'heads.png'),
  tails: path.join(ASSET_DIR, 'tails.png'),
};
const RESULT_DIR = path.join(ASSET_DIR, 'results');
const ROUND_DELAY_MS = 3000;

function createFlippingAttachment(currentRound) {
  return new AttachmentBuilder(GIF_ASSET, { name: `round-${currentRound}-coinflip.gif` });
}

function resultKey(results) {
  return results.map(result => result === 'heads' ? 'H' : 'T').join('-');
}

function createResultAttachment(results) {
  return new AttachmentBuilder(path.join(RESULT_DIR, `result-${resultKey(results)}.png`), {
    name: `result-${resultKey(results)}.png`,
  });
}

function createFlippingEmbed(currentRound, rounds, completedResults) {
  const embed = new EmbedBuilder()
    .setColor(0x272730)
    .setTitle(`Coinflip - Round ${currentRound}/${rounds}`)
    .setDescription('The coin is flipping...')
    .setImage(`attachment://round-${currentRound}-coinflip.gif`)
    .setFooter({ text: `Bot v${BOT_VERSION}` });
  if (completedResults.length) {
    embed.setThumbnail(`attachment://result-${resultKey(completedResults)}.png`);
  }
  return embed;
}

function createSummaryEmbed() {
  return new EmbedBuilder()
    .setColor(0x272730)
    .setTitle('Coinflip Results')
    .setFooter({ text: `Bot v${BOT_VERSION}` })
    .setTimestamp();
}

async function assertAssets() {
  await Promise.all([GIF_ASSET, RESULT_ASSETS.heads, RESULT_ASSETS.tails].map(file => fs.access(file)));
}

function generateResults(rounds) {
  return Array.from({ length: rounds }, () => randomInt(2) === 0 ? 'heads' : 'tails');
}

async function assertResultAssets(results) {
  const paths = results.map((_, index) => path.join(
    RESULT_DIR,
    `result-${resultKey(results.slice(0, index + 1))}.png`,
  ));
  await Promise.all(paths.map(file => fs.access(file)));
}

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin one or more times.')
    .addIntegerOption(option => option
      .setName('rounds')
      .setDescription('Number of flips (1-5).')
      .setMinValue(1)
      .setMaxValue(5)
    ),

  async execute(interaction) {
    const rounds = interaction.options.getInteger('rounds') || 1;
    const completedResults = [];
    const results = generateResults(rounds);

    try {
      await assertAssets();
      await assertResultAssets(results);

      await interaction.editReply({
        content: null,
        embeds: [createFlippingEmbed(1, rounds, completedResults)],
        attachments: [],
        files: [createFlippingAttachment(1)],
      });

      for (let round = 1; round <= rounds; round++) {
        await delay(ROUND_DELAY_MS);
        completedResults.push(results[round - 1]);

        if (round === rounds) {
          const resultAttachment = createResultAttachment(completedResults);
          const resultName = `result-${resultKey(completedResults)}.png`;
          const embed = rounds === 1
            ? new EmbedBuilder()
              .setColor(0x272730)
              .setTitle(`Coinflip: ${completedResults[0].toUpperCase()}`)
              .setImage(`attachment://${resultName}`)
              .setFooter({ text: `Bot v${BOT_VERSION}` })
              .setTimestamp()
            : createSummaryEmbed().setImage(`attachment://${resultName}`);
          await interaction.editReply({
            content: null,
            embeds: [embed],
            attachments: [],
            files: [resultAttachment],
          });
        } else {
          await interaction.editReply({
            content: null,
            embeds: [createFlippingEmbed(round + 1, rounds, completedResults)],
            attachments: [],
            files: [createFlippingAttachment(round + 1), createResultAttachment(completedResults)],
          });
        }
      }
    } catch (err) {
      logger.error(`Coinflip failed for ${interaction.user.tag}: ${err.stack || err.message}`);
      try {
        await interaction.editReply({
          content: err.code === 'ENOENT'
            ? 'Coinflip failed because an animation asset is missing.'
            : 'Coinflip failed. Please try again later.',
          embeds: [],
          attachments: [],
          files: [],
        });
      } catch (editErr) {
        logger.error(`Coinflip error reply failed: ${editErr.stack || editErr.message}`);
      }
    }
  },
  _test: { resultKey, generateResults, createSummaryEmbed },
};
