const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../config/logger');
const { truncate } = require('../utils/text');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deploy')
    .setDescription('[Admin] Load template and deploy/update the role panel.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction, { botMember, template, guild }) {
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.editReply('I am missing the **Manage Roles** permission. Please grant it and retry.');
    }

    try {
      const result = await guild.client._deployMessage(guild);
      const message = result.message || result;
      const warnings = result.warnings || [];
      const total = template.totalPages();
      let reply = `Panel deployed!\n**Message:** \`${message.id}\` in <#${message.channel.id}>\n**Roles:** ${template.roles.length}  **Pages:** ${total}\nMembers click **Pick Your Role** to get their own private picker.`;
      if (warnings.length) {
        reply += '\n\n**⚠️ Warnings:**\n' + warnings.map(w => `${w}`).join('\n');
      }
      await interaction.editReply(truncate(reply, 1900));
    } catch (err) {
      if (String(err.message || '').includes('Template file not found')) {
        await interaction.editReply('Template file not found. Check `TEMPLATE_FILE` path.');
      } else if (String(err.message || '').includes('not found in this guild')) {
        await interaction.editReply(truncate(`Template validation failed: ${err.message}`, 1900));
      } else if (String(err.message || '').includes('syntax error') || String(err.message || '').includes('missing')) {
        await interaction.editReply('Template validation failed. Check the template JSON syntax.');
      } else if (/dangerous|managed|duplicate|invalid style|unknown .*key|self-assign|template/i.test(String(err.message || ''))) {
        await interaction.editReply(truncate(`Template validation failed: ${err.message}`, 1900));
      } else {
        logger.error(`Deploy thất bại: ${err.message}`);
        await interaction.editReply('An unexpected error occurred.');
      }
    }
  }
};
