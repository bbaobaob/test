const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('[Admin] Show a member\'s current template role and assignment history.')
    .addUserOption(opt => opt.setName('member').setDescription('The server member to inspect.').setRequired(true)),

  async execute(interaction, { client, guild }) {
    const member = interaction.options.getMember('member');
    if (!member) {
      return interaction.followUp('Could not find that member. They may not be cached.');
    }
    const templateIdToLabel = {};
    for (const e of client._template.roles) {
      templateIdToLabel[e.id] = e.label;
    }

    const liveTemplateRoles = member.roles.cache.filter(r => templateIdToLabel[r.id]);
    const histEntry = client._stats.userEntry(member.id);
    const changeCount = client._stats.perUserChangeCount(member.id);

    const embed = new EmbedBuilder()
      .setTitle(`User Info: ${member.displayName}`)
      .setColor(member.color || 0x57B5F2)
      .setTimestamp()
      .setThumbnail(member.displayAvatarURL())
      .addFields(
        { name: 'Username', value: String(member), inline: true },
        { name: 'User ID', value: `\`${member.id}\``, inline: true },
        { name: 'Role Changes', value: `\`${changeCount}\``, inline: true },
        { name: 'Joined', value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:D>` : 'Unknown', inline: true },
        { name: 'Current Template Role(s)', value: liveTemplateRoles.size
          ? liveTemplateRoles.map(r => `**${r.name}**`).join(', ')
          : '*(none)*', inline: false }
      );

    if (histEntry) {
      const lastRole = histEntry.role_name || 'Unknown';
      const lastTs = (histEntry.ts || 'Unknown').slice(0, 10);
      embed.addFields({ name: 'Last Recorded Assignment', value: `**${lastRole}** on \`${lastTs}\``, inline: false });
    } else {
      embed.addFields({ name: 'Last Recorded Assignment', value: '*(no stats history — may have joined before v1.5)*', inline: false });
    }

    embed.setFooter({ text: `Bot v${BOT_VERSION}` });
    await interaction.followUp({ embeds: [embed] });
  }
};
