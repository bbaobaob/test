const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { BOT_VERSION, ROLE_LIST_MAX, ENABLE_LIVE_MEMBER_CACHE } = require('../config/config');
const { safeMarkdownField, joinLimited } = require('../utils/text');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('[Admin] Advanced role analytics — dashboard or per-role drill-down.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(opt =>
      opt.setName('role').setDescription('Optional: drill down into a specific role\'s stats.').setAutocomplete(true)
    ),

  async autocomplete(interaction, client) {
    const focused = interaction.options.getFocused().toLowerCase();
    const labels = client._template.roleLabels();
    const matches = labels.filter(l => l.includes(focused)).slice(0, 25);
    await interaction.respond(matches.map(l => ({ name: l, value: l })));
  },

  async execute(interaction, { client, guild }) {
    const role = interaction.options.getString('role');
    const stats = client._stats;

    if (role) {
      const entry = client._template.findRoleByLabel(role);
      if (!entry) {
        return interaction.editReply(`**${safeMarkdownField(role, 100)}** is not in the template. Use autocomplete to pick a valid role name.`);
      }

      const roleId = entry.id;
      const discRole = guild.roles.cache.get(roleId);
      // Stats are recorded under the Discord role NAME (see roleManager), not
      // the template label — resolve before querying or counts silently read 0
      // whenever label !== role name.
      const statsKey = discRole ? discRole.name : entry.label;
      const liveMembers = guild.client._liveRoleMembers
        ? await guild.client._liveRoleMembers(guild, roleId)
        : [];
      const assignCount = stats.roleAssignmentCount(statsKey);
      const history = stats.roleHistory(statsKey);
      const liveCount = liveMembers.length;
      const histCount = history.length;

      const embed = new EmbedBuilder()
        .setTitle(`Role Drill-Down: ${safeMarkdownField(role, 180)}`)
        .setColor(discRole ? discRole.color : 0x9B59B6)
        .setTimestamp()
        .addFields(
          { name: 'Live Members', value: ENABLE_LIVE_MEMBER_CACHE ? `\`${liveCount}\`` : 'disabled', inline: true },
          { name: 'All-time Assigned', value: `\`${assignCount}\``, inline: true },
          { name: 'Currently Tracked', value: `\`${histCount}\``, inline: true }
        );

      if (discRole) {
        embed.addFields({ name: 'Discord Role', value: `${discRole}  (position \`${discRole.position}\`)`, inline: false });
      }

      if (liveMembers.length) {
        const shown = liveMembers.slice(0, ROLE_LIST_MAX);
        const extra = liveCount - shown.length;
        let body = shown.map(n => `\`${safeMarkdownField(n, 80)}\``).join(', ');
        if (extra > 0) body += ` … and **${extra}** more`;
        embed.addFields({ name: 'Who Has This Role (live)', value: joinLimited([body], '\n', 1024), inline: false });
      } else {
        embed.addFields({
          name: 'Who Has This Role (live)',
          value: ENABLE_LIVE_MEMBER_CACHE ? '*(nobody)*' : 'Live member cache is disabled for low-RAM mode.',
          inline: false,
        });
      }

      if (history.length) {
        const lines = history.slice(0, 8).map(e => {
          const ts = (e.ts || '').slice(0, 10);
          return `\`${ts}\` **${safeMarkdownField(e.user_name, 80)}**`;
        });
        embed.addFields({ name: 'Recent Assignees (stats history)', value: joinLimited(lines, '\n', 1024), inline: false });
      }

      const footerText = ENABLE_LIVE_MEMBER_CACHE
        ? 'Live data from guild cache'
        : 'LOW_RAM_MODE disables live member cache';
      embed.setFooter({ text: `Bot v${BOT_VERSION} • ${footerText}` });

      return interaction.editReply({ embeds: [embed] });
    }

    // Dashboard view
    const top = stats.topRoles(10);
    const recent = stats.recentEntries(8);
    const daily = stats.dailyStats(7);

    let liveCounts = {};
    let liveTotal = 0;
    if (guild && client._template.roles.length) {
      if (guild.client._liveRoleCounts) {
        liveCounts = await guild.client._liveRoleCounts(guild);
        liveTotal = Object.values(liveCounts).reduce((a, b) => a + b, 0);
      }
    }

    const labelToId = {};
    for (const e of client._template.roles) {
      labelToId[e.label] = e.id;
    }

    const embed = new EmbedBuilder()
      .setTitle('Role Assignment Dashboard')
      .setColor(0x9B59B6)
      .setTimestamp()
      .addFields(
        { name: 'Total Assignments', value: `\`${stats.total}\``, inline: true },
        { name: 'Unique Users', value: `\`${stats.uniqueUsers}\``, inline: true },
        { name: 'Live Role Holders', value: ENABLE_LIVE_MEMBER_CACHE ? `\`${liveTotal}\`` : 'disabled', inline: true },
        { name: 'Roles Available', value: `\`${client._template.roles.length || '—'}\``, inline: true }
      );

    if (top.length) {
      const maxCount = Math.max(top[0][1], 1);
      const barLines = top.map(([roleName, count]) => {
        const barLen = Math.round(count / maxCount * 10);
        const bar = '█'.repeat(barLen) + '░'.repeat(10 - barLen);
        const rid = labelToId[roleName];
        const liveStr = (ENABLE_LIVE_MEMBER_CACHE && rid && liveCounts[rid] !== undefined)
          ? ` 👥${liveCounts[rid]}`
          : '';
        return `\`${bar}\` **${safeMarkdownField(roleName, 80)}** (${count}${liveStr})`;
      });
      embed.addFields({
        name: ENABLE_LIVE_MEMBER_CACHE ? 'Top Roles  *(assignments • live)*' : 'Top Roles  *(assignments)*',
        value: joinLimited(barLines, '\n', 1024) || '*(no data)*',
        inline: false,
      });
    } else {
      embed.addFields({ name: 'Top Roles', value: '*(no assignments yet)*', inline: false });
    }

    const hasDaily = daily.some(([_, c]) => c > 0);
    if (hasDaily) {
      const peak = Math.max(...daily.map(([_, c]) => c), 1);
      const trendLines = daily.map(([dateStr, count]) => {
        const barLen = count ? Math.round(count / peak * 8) : 0;
        const bar = '▓'.repeat(barLen) + '░'.repeat(8 - barLen);
        return `\`${dateStr.slice(5)}\` \`${bar}\` ${count}`;
      });
      embed.addFields({ name: 'Daily Activity  *(last 7 days)*', value: joinLimited(trendLines, '\n', 1024), inline: false });
    }

    if (recent.length) {
      const lines = recent.map(e => {
        const tsShort = (e.ts || '').slice(11, 16);
        const removed = e.removed && e.removed.length ? ` ← ${e.removed.map(r => safeMarkdownField(r, 40)).join(', ')}` : '';
        const action = e.action && e.action !== 'add' ? ` (${e.action})` : '';
        return `\`${tsShort}\` **${safeMarkdownField(e.user_name, 80)}** → ${safeMarkdownField(e.role_name, 80)}${action}${removed}`;
      });
      embed.addFields({ name: 'Recent Activity', value: joinLimited(lines, '\n', 1024), inline: false });
    } else {
      embed.addFields({ name: 'Recent Activity', value: '*(none yet)*', inline: false });
    }

    embed.setFooter({ text: `Bot v${BOT_VERSION} • Tip: /stats role:<n> for drill-down` });
    await interaction.editReply({ embeds: [embed] });
  }
};
