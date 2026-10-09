const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { BOT_VERSION, PICKER_TIMEOUT, MEMBER_CACHE_TTL, LOW_RAM_MODE, ENABLE_MEMBER_INTENT, ENABLE_LIVE_MEMBER_CACHE } = require('../config/config');
const { loadState } = require('../utils/stateStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('[Admin] Show bot status, template info, and permission check.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction, { client, botMember, template, state, startTime }) {
    const hasPerms = botMember && botMember.permissions.has(PermissionsBitField.Flags.ManageRoles);
    const delta = Date.now() - startTime;
    const h = Math.floor(delta / 3600000);
    const m = Math.floor((delta % 3600000) / 60000);
    const s = Math.floor((delta % 60000) / 1000);

    const tLoaded = !!template.templateName;
    const tName = template.templateName || '*(not loaded)*';
    const rCount = tLoaded ? template.roles.length : 0;
    const pTotal = tLoaded ? template.totalPages() : 0;

    const msgId = state ? state.message_id : null;
    const chanId = state ? state.channel_id : null;
    const msgStr = msgId ? `\`${msgId}\`` : '*(none)*';
    const chStr = chanId ? `<#${chanId}>` : '*(none)*';

    const cacheAge = ENABLE_LIVE_MEMBER_CACHE && client._memberCacheTs > 0
      ? `${Math.floor((Date.now() - client._memberCacheTs) / 1000)}s ago`
      : 'disabled';
    const lockCnt = client._roleManager._lockCount;
    const wsPing = client.ws.ping;
    const wsMs = wsPing >= 0 ? Math.round(wsPing * 10) / 10 : null;

    const embed = new EmbedBuilder()
      .setTitle('Bot Status')
      .setColor(hasPerms ? 0x57B5F2 : 0xE74C3C)
      .addFields(
        { name: 'Version', value: `\`${BOT_VERSION}\``, inline: true },
        { name: 'Uptime', value: `${h}h ${m}m ${s}s`, inline: true },
        { name: 'WS Latency', value: wsMs !== null ? `\`${wsMs} ms\`` : 'connecting …', inline: true },
        { name: 'Template', value: tName, inline: true },
        { name: 'Roles', value: String(rCount), inline: true },
        { name: 'Pages', value: String(pTotal), inline: true },
        { name: 'Channel', value: chStr, inline: true },
        { name: 'Message', value: msgStr, inline: true },
        { name: 'Picker Timeout', value: `${PICKER_TIMEOUT}s`, inline: true },
        { name: 'Member Cache', value: cacheAge, inline: true },
        { name: 'Cache TTL', value: `${MEMBER_CACHE_TTL}s`, inline: true },
        { name: 'Active Locks', value: String(lockCnt), inline: true },
        { name: 'Low RAM', value: LOW_RAM_MODE ? 'enabled' : 'disabled', inline: true },
        { name: 'Members Intent', value: ENABLE_MEMBER_INTENT ? 'enabled' : 'disabled', inline: true },
        { name: 'Manage Roles', value: hasPerms ? 'Granted' : 'MISSING', inline: true }
      )
      .setFooter({ text: `Bot v${BOT_VERSION}` });

    const metrics = client._metrics;
    embed.addFields(
      { name: 'DB Records', value: `\`${client._stats.total}\` assignments · \`${client._stats.uniqueUsers}\` users`, inline: true },
      { name: 'Commands', value: `\`${metrics.totalCommands}\` served · \`${Math.round(metrics.avgLatencyMs * 10) / 10}\` ms avg`, inline: true },
      { name: 'Errors', value: metrics.totalErrors ? `\`${metrics.totalErrors}\` errors` : 'None', inline: true }
    );

    await interaction.editReply({ embeds: [embed] });
  }
};
