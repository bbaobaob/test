const { MessageFlags } = require('discord.js');
const config = require('../config/config');
const logger = require('../config/logger');
const { buildPickerComponents } = require('./componentBuilder');

// ── Shared validation (deduplicated from each handler) ────────
function validateSession(interaction, client) {
  if (interaction.guildId !== config.GUILD_ID) {
    return 'This bot is not configured for your server.';
  }
  return null;
}

function checkCooldown(interaction, client) {
  const now = Date.now();
  const lastClick = client._cooldowns.get(interaction.user.id) || 0;
  const remaining = config.COOLDOWN_SECONDS * 1000 - (now - lastClick);
  if (remaining > 0) {
    return `Please wait **${(remaining / 1000).toFixed(1)}s** before clicking again.`;
  }
  client._cooldowns.set(interaction.user.id, now);
  return null;
}

// ── Handlers ──────────────────────────────────────────────

async function handleOpenPicker(interaction, client) {
  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  if (!client._template.roles.length) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  // Check cooldown on open picker too (was missing)
  const cooldownMsg = checkCooldown(interaction, client);
  if (cooldownMsg) {
    return interaction.followUp({ content: cooldownMsg, flags: MessageFlags.Ephemeral });
  }

  client._pickerManager.set(interaction.user.id, {
    userId: interaction.user.id,
    page: 1,
    createdAt: Date.now(),
    timeout: config.PICKER_TIMEOUT,
  });

  const embed = client._template.buildPickerEmbed(1);
  const ownedRoleIds = new Set(interaction.member.roles.cache.map(r => r.id));
  const components = buildPickerComponents(1, ownedRoleIds, client._template);
  await interaction.followUp({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

async function handleRoleButton(interaction, client) {
  const roleId = interaction.customId.split(':')[2];
  const session = client._pickerManager.get(interaction.user.id);
  if (!session) {
    return interaction.reply({ content: 'Your picker session has expired. Click **Pick Your Role** again.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.user.id !== session.userId) {
    return interaction.reply({ content: 'This picker belongs to someone else.', flags: MessageFlags.Ephemeral });
  }
  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  const cooldownMsg = checkCooldown(interaction, client);
  if (cooldownMsg) {
    return interaction.reply({ content: cooldownMsg, flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferUpdate();
  } catch {
    return;
  }

  const guild = interaction.guild;
  const member = interaction.member;
  const targetRole = guild.roles.cache.get(roleId);
  if (!targetRole) {
    return interaction.followUp({ content: 'That role no longer exists. Contact an admin.', flags: MessageFlags.Ephemeral });
  }

  try {
    const result = await client._roleManager.assignRole(
      member, targetRole,
      client._template.roles.map(r => r.id),
      guild
    );

    const action = result.action;
    const page = session.page;
    const statusMsg = action === 'added'
      ? `✅ Now have **${result.roleName}**`
      : `❌ Removed **${result.roleName}**`;

    const ownedRoleIds = new Set(member.roles.cache.map(r => r.id));
    if (action === 'added') {
      ownedRoleIds.add(targetRole.id);
    } else {
      ownedRoleIds.delete(targetRole.id);
    }

    const pickerEmbed = client._template.buildPickerEmbed(page, statusMsg);
    const components = buildPickerComponents(page, ownedRoleIds, client._template);
    await interaction.editReply({ embeds: [pickerEmbed], components });
  } catch (err) {
    if (!err.message.includes('lack Manage Roles')) {
      logger.error(`handleRoleButton error (user ${interaction.user.id}, role ${roleId}): ${err.stack || err.message}`);
    }
    const msg = err.message.includes('lack Manage Roles')
      ? err.message
      : 'An unexpected error occurred. Please try again.';
    try { await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }); } catch {}
  }
}

async function handleRemoveAll(interaction, client) {
  const session = client._pickerManager.get(interaction.user.id);
  if (!session) {
    return interaction.reply({ content: 'Your picker session has expired.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== session.userId) {
    return interaction.reply({ content: 'This picker belongs to someone else.', flags: MessageFlags.Ephemeral });
  }
  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  const cooldownMsg = checkCooldown(interaction, client);
  if (cooldownMsg) {
    return interaction.reply({ content: cooldownMsg, flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferUpdate();
  } catch {
    return;
  }

  const guild = interaction.guild;
  const member = interaction.member;

  try {
    const removed = await client._roleManager.clearMemberRoles(
      member,
      client._template.roles.map(r => r.id),
      guild,
      'Self-service role removal'
    );

    const page = session.page;
    const statusMsg = removed.length
      ? `🗑️ Removed all roles`
      : `You don't have any role from this picker.`;

    const ownedRoleIds = new Set(member.roles.cache.map(r => r.id));
    for (const r of removed) {
      ownedRoleIds.delete(r.id);
    }

    const pickerEmbed = client._template.buildPickerEmbed(page, statusMsg);
    const components = buildPickerComponents(page, ownedRoleIds, client._template);
    await interaction.editReply({ embeds: [pickerEmbed], components });
  } catch (err) {
    if (!err.message.includes('lack Manage Roles')) {
      logger.error(`handleRemoveAll error (user ${interaction.user.id}): ${err.stack || err.message}`);
    }
    const msg = err.message.includes('lack Manage Roles')
      ? err.message
      : 'An unexpected error occurred. Please try again.';
    try { await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }); } catch {}
  }
}

async function handleNavigation(interaction, client) {
  const session = client._pickerManager.get(interaction.user.id);
  if (!session) {
    return interaction.reply({ content: 'Your picker session has expired.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== session.userId) {
    return interaction.reply({ content: 'This picker belongs to someone else.', flags: MessageFlags.Ephemeral });
  }
  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  const total = client._template.totalPages();
  const direction = interaction.customId === 'picker:next' ? 1 : -1;
  const newPage = Math.max(1, Math.min(total, session.page + direction));

  if (newPage === session.page) {
    try { await interaction.deferUpdate(); } catch {}
    return;
  }

  session.page = newPage;

  const embed = client._template.buildPickerEmbed(newPage);
  const ownedRoleIds = new Set(interaction.member.roles.cache.map(r => r.id));
  const components = buildPickerComponents(newPage, ownedRoleIds, client._template);
  try {
    await interaction.update({ embeds: [embed], components });
  } catch {}
}

async function handleButton(interaction, client) {
  const customId = interaction.customId;

  if (customId === 'panel:open_picker') {
    return handleOpenPicker(interaction, client);
  }

  if (customId.startsWith('picker:role:')) {
    return handleRoleButton(interaction, client);
  }

  if (customId === 'picker:remove_all') {
    return handleRemoveAll(interaction, client);
  }

  if (customId === 'picker:prev' || customId === 'picker:next') {
    return handleNavigation(interaction, client);
  }

  logger.warn(`Unknown button custom_id: ${customId}`);
}

module.exports = { handleButton };
