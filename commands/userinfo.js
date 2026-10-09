const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const logger = require('../config/logger');
const { safeMarkdownField, joinLimited } = require('../utils/text');

const KEY_PERMS = [
  { flag: PermissionsBitField.Flags.Administrator, label: 'Administrator' },
  { flag: PermissionsBitField.Flags.ManageGuild, label: 'Manage Server' },
  { flag: PermissionsBitField.Flags.ManageRoles, label: 'Manage Roles' },
  { flag: PermissionsBitField.Flags.ManageChannels, label: 'Manage Channels' },
  { flag: PermissionsBitField.Flags.KickMembers, label: 'Kick Members' },
  { flag: PermissionsBitField.Flags.BanMembers, label: 'Ban Members' },
  { flag: PermissionsBitField.Flags.ManageMessages, label: 'Manage Messages' },
  { flag: PermissionsBitField.Flags.ModerateMembers, label: 'Moderate Members' },
];

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription("View a user's profile information.")
    .addUserOption(opt =>
      opt.setName('user').setDescription('The user to inspect (default: yourself).')
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const member = interaction.options.getMember('user')
      || interaction.guild.members.cache.get(target.id)
      || await interaction.guild.members.fetch(target.id).catch(() => null);

    logger.info(`Userinfo: ${target.tag} (requested by ${interaction.user.tag})`);

    const roleList = member?.roles.cache.filter(r => r.id !== interaction.guild.id);
    const highestRole = member?.roles.highest;

    const embed = new EmbedBuilder()
      .setTitle(safeMarkdownField(target.displayName, 256))
      .setThumbnail(target.displayAvatarURL({ size: 1024 }))
      .setColor(member?.displayColor || 0x5865F2)
      .addFields(
        { name: 'Username', value: safeMarkdownField(target.tag, 256), inline: true },
        { name: 'ID', value: `\`${target.id}\``, inline: true },
        { name: 'Bot', value: target.bot ? 'Yes' : 'No', inline: true },
      )
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp(target.createdAt);

    if (member) {
      const roleMentions = roleList.map(r => `<@&${r.id}>`);
      const roles = joinLimited(roleMentions, ' ', 1024);

      const keyPerms = KEY_PERMS
        .filter(p => member.permissions.has(p.flag))
        .map(p => p.label);

      embed.addFields(
        { name: 'Joined Server', value: `<t:${Math.floor(member.joinedAt / 1000)}:R>\n<t:${Math.floor(member.joinedAt / 1000)}:F>`, inline: true },
        { name: 'Registered', value: `<t:${Math.floor(target.createdAt / 1000)}:R>\n<t:${Math.floor(target.createdAt / 1000)}:F>`, inline: true },
        { name: `Roles [${roleList.size}]`, value: roles || 'None', inline: false },
      );

      if (keyPerms.length) {
        embed.addFields({ name: 'Key Permissions', value: keyPerms.join('\n'), inline: false });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
