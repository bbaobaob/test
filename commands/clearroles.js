const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const logger = require('../config/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearroles')
    .setDescription('[Admin] Remove ALL template roles from a specific member.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addUserOption(opt => opt.setName('member').setDescription('The server member whose template roles should be cleared.').setRequired(true)),

  async execute(interaction, { client, guild }) {
    if (!client._template.roles.length) {
      return interaction.editReply('No template loaded — run `/deploy` first.');
    }

    const member = interaction.options.getMember('member');
    if (!member) {
      return interaction.editReply('Could not find that member. They may not be cached. Enable `ENABLE_MEMBER_INTENT=1` and `LOW_RAM_MODE=0` to ensure all members are reachable.');
    }

    const templateIds = client._template.roles.map(e => e.id);

    try {
      const removed = await client._roleManager.clearMemberRoles(member, templateIds, guild);

      if (!removed.length) {
        return interaction.editReply(`**${member.displayName}** had no template roles — nothing to clear.`);
      }

      const removedStr = removed.map(r => `**${r.name}**`).join(', ');
      const embed = new EmbedBuilder()
        .setTitle('Roles Cleared')
        .setDescription(`Removed **${removed.length}** role(s) from **${member.displayName}**:\n${removedStr}`)
        .setColor(0xE67E22)
        .setTimestamp()
        .setFooter({ text: `Cleared by ${interaction.user.displayName} | Bot v${BOT_VERSION}` });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (err.status === 403 || (err.message && err.message.includes('lack Manage Roles'))) {
        await interaction.editReply(err.message);
      } else {
        logger.error(`Lỗi không mong muốn trong /clearroles: ${err.message}`);
        await interaction.editReply('An unexpected error occurred.');
      }
    }
  }
};
