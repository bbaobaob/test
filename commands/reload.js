const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../config/logger');
const { truncate } = require('../utils/text');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('[Admin] Reload the template and refresh the panel.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction, { template, guild, state }) {
    if (!state) {
      return interaction.editReply('No deployed panel found. Run `/deploy` first.');
    }

    try {
      const result = await guild.client._deployMessage(guild);
      const total = template.totalPages();
      const warnings = result.warnings || [];
      let reply = `Panel reloaded!\n**Roles:** ${template.roles.length}  **Pages:** ${total}`;
      if (warnings.length) {
        reply += '\n\n**⚠️ Warnings:**\n' + warnings.map(w => `${w}`).join('\n');
      }
      await interaction.editReply(truncate(reply, 1900));
    } catch (err) {
      if (String(err.message || '').includes('Template file not found')) {
        await interaction.editReply('Template file not found.');
      } else if (String(err.message || '').includes('not found in this guild')) {
        await interaction.editReply(truncate(`Template validation failed: ${err.message}`, 1900));
      } else if (String(err.message || '').includes('syntax error') || String(err.message || '').includes('missing')) {
        await interaction.editReply('Template validation failed.');
      } else if (/dangerous|managed|duplicate|invalid style|unknown .*key|self-assign|template/i.test(String(err.message || ''))) {
        await interaction.editReply(truncate(`Template validation failed: ${err.message}`, 1900));
      } else {
        logger.error(`Reload thất bại: ${err.message}`);
        await interaction.editReply('An unexpected error occurred.');
      }
    }
  }
};
