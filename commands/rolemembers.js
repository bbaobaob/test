const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { BOT_VERSION, ROLE_LIST_MAX, ENABLE_LIVE_MEMBER_CACHE } = require('../config/config');
const { safeMarkdownField, joinLimited } = require('../utils/text');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolemembers')
    .setDescription('[Admin] Live list of members who currently have a template role.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(opt =>
      opt.setName('role').setDescription('Template role to inspect.').setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction, client) {
    const focused = interaction.options.getFocused().toLowerCase();
    const labels = client._template.roleLabels();
    const matches = labels.filter(l => l.includes(focused)).slice(0, 25);
    await interaction.respond(matches.map(l => ({ name: l, value: l })));
  },

  async execute(interaction, { client, guild }) {
    const role = interaction.options.getString('role');
    const entry = client._template.findRoleByLabel(role);
    if (!entry) {
      return interaction.editReply(`**${safeMarkdownField(role, 100)}** is not a template role. Use autocomplete to pick a valid name.`);
    }

    const roleId = entry.id;
    const discRole = guild.roles.cache.get(roleId);
    if (!discRole) {
      return interaction.editReply(`Role **${safeMarkdownField(role, 100)}** (ID \`${roleId}\`) no longer exists in this server.`);
    }

    if (!ENABLE_LIVE_MEMBER_CACHE) {
      return interaction.editReply(
        'Live member cache is disabled for low-RAM Termux mode. Set `ENABLE_LIVE_MEMBER_CACHE=1` and `ENABLE_MEMBER_INTENT=1` if you need `/rolemembers`.'
      );
    }

    const members = await guild.client._liveRoleMembers(guild, roleId);
    const count = members.length;

    const embed = new EmbedBuilder()
      .setTitle(`Members with: ${safeMarkdownField(discRole.name, 120)}`)
      .setColor(discRole.color || 0x57B5F2)
      .setTimestamp()
      .addFields(
        { name: 'Live Count', value: `\`${count}\``, inline: true },
        { name: 'All-time Assigned', value: `\`${client._stats.roleAssignmentCount(role)}\``, inline: true },
        { name: 'Role Position', value: `\`${discRole.position}\``, inline: true }
      );

    if (count) {
      const shown = members.slice(0, ROLE_LIST_MAX).map(n => safeMarkdownField(n, 80));
      const extra = count - shown.length;
      if (extra > 0) shown.push(`*… and ${extra} more*`);
      embed.addFields({ name: 'Members', value: joinLimited(shown, '\n', 1024), inline: false });
    } else {
      embed.addFields({ name: 'Members', value: '*(nobody has this role right now)*', inline: false });
    }

    embed.setFooter({ text: `Bot v${BOT_VERSION} | Live from guild member cache` });
    await interaction.editReply({ embeds: [embed] });
  }
};
