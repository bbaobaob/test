const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../config/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetgayrate')
    .setDescription('[Admin] Reset gayrate seed for a user or everyone.')
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to reset (leave empty to reset ALL).')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction, { client }) {
    const targetUser = interaction.options.getUser('user');

    if (targetUser) {
      const newSeed = client._stats.resetGayrateSeed(targetUser.id);
      logger.info(`Reset gayrate: ${targetUser.tag} -> new seed ${newSeed} (by ${interaction.user.tag})`);
      await interaction.editReply(`Reset gayrate seed for **${targetUser.tag}** ✅`);
    } else {
      client._stats.resetAllGayrateSeeds();
      logger.info(`Reset gayrate: ALL users reset (by ${interaction.user.tag})`);
      await interaction.editReply('Reset gayrate seed for **ALL users** ✅');
    }
  }
};
