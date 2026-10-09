const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');
const config = require('../config/config');
const logger = require('../config/logger');
const { buildPickerComponents, buildSearchResultComponents, buildConfirmComponents, pickerId, parsePickerCustomId } = require('./componentBuilder');
const { buildEmbed: buildChangelogEmbed } = require('../commands/changelog');
const { safeMarkdownField } = require('../utils/text');

const CHANGELOG_PATH = path.join(__dirname, '..', 'data', 'changelog.json');

// Cache the parsed changelog so button pagination doesn't re-read the file on
// every click (it's a hot path — interaction handlers should stay off disk).
// Invalidated when the file's mtime changes.
let _changelogCache = null;

function loadChangelogEntries() {
  try {
    const stat = fs.statSync(CHANGELOG_PATH);
    if (_changelogCache && _changelogCache.mtimeMs === stat.mtimeMs) {
      return _changelogCache.entries;
    }
    const data = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf-8'));
    const entries = data.entries || [];
    if (!entries.length) return [];
    _changelogCache = { mtimeMs: stat.mtimeMs, entries };
    return entries;
  } catch {
    return [];
  }
}

function newSessionId() {
  return crypto.randomBytes(6).toString('hex');
}

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
  return remaining > 0 ? remaining : 0;
}

// Silent cooldown gate: if the user is clicking too fast, acknowledge the
// interaction (so Discord doesn't flag it as failed) but do nothing — no
// "please wait" text. Rapid clicks simply feel unresponsive instead of
// spamming the user with messages. Returns true if blocked (caller should
// return early).
async function enforceCooldown(interaction, client) {
  const remaining = checkCooldown(interaction, client);
  if (remaining <= 0) return false;
  // Acknowledge silently so the click doesn't error out, then drop it.
  try {
    if (interaction.isButton() && !interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate().catch(() => {});
    }
  } catch (_) {}
  return true;
}

function markCooldown(interaction, client) {
  client._cooldowns.set(interaction.user.id, Date.now());
}

// ── Helper: fetch owned role IDs from session or member ──
function getOwnedRoleIds(member) {
  return new Set(member.roles.cache.map(r => r.id));
}

// Auto-create a session if one doesn't exist — buttons never "expire".
function ensureSession(interaction, client, sessionId = null) {
  if (!client._template || !client._template.roles.length) return null;
  let session = client._pickerManager.get(interaction.user.id, sessionId);
  if (session) return session;
  const ownedRoleIds = getOwnedRoleIds(interaction.member);
  session = {
    userId: interaction.user.id,
    sessionId: sessionId || newSessionId(),
    page: 1,
    createdAt: Date.now(),
    timeout: 86400, // 24h — effectively never
    ownedRoleIds,
  };
  client._pickerManager.set(interaction.user.id, session);
  return session;
}

// ── Handlers ──────────────────────────────────────────────

async function handleOpenPicker(interaction, client) {
  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  if (!client._template.roles.length) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }

  // Check cooldown BEFORE deferring to avoid consuming interaction slots.
  // Silent: rapid clicks are dropped without a "please wait" message.
  if (await enforceCooldown(interaction, client)) return;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    logger.warn(`deferReply thất bại cho open picker (user ${interaction.user.id}): ${err.message}`);
    await interaction.reply({ content: 'Could not open the picker. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const ownedRoleIds = getOwnedRoleIds(interaction.member);
  const sessionId = newSessionId();
  client._pickerManager.set(interaction.user.id, {
    userId: interaction.user.id,
    sessionId,
    page: 1,
    createdAt: Date.now(),
    timeout: config.PICKER_TIMEOUT,
    ownedRoleIds: new Set(ownedRoleIds),
  });

  const embed = client._template.buildPickerEmbed(1);
  const components = buildPickerComponents(1, ownedRoleIds, client._template, sessionId);
  await interaction.editReply({ embeds: [embed], components });
  // NOTE: do NOT markCooldown here. The picker open is navigation, not a role
  // mutation. Marking cooldown here would silently swallow the user's very
  // first role click (within COOLDOWN_SECONDS of opening), making the bot feel
  // unresponsive on first click.
}

async function handleRoleButton(interaction, client, parsed) {
  const roleId = parsed?.args?.[0];
  if (!roleId) {
    return interaction.reply({ content: 'Invalid role button. Please reopen the picker.', flags: MessageFlags.Ephemeral });
  }
  if (!client._template.hasRoleId(roleId)) {
    return interaction.reply({ content: 'That role is no longer available in this picker. Please reopen the picker.', flags: MessageFlags.Ephemeral });
  }
  const session = ensureSession(interaction, client, parsed?.sessionId || null);
  if (!session) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }

  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  if (await enforceCooldown(interaction, client)) return;

  // Check if confirm is pending (shouldn't happen since confirm buttons replace picker)
  if (session.pendingConfirm) {
    return interaction.reply({ content: 'Please respond to the confirmation prompt first.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.warn(`deferUpdate thất bại cho role button (user ${interaction.user.id}): ${err.message}`);
    return;
  }

  const guild = interaction.guild;
  const member = interaction.member;
  const targetRole = guild.roles.cache.get(roleId);
  if (!targetRole) {
    return interaction.followUp({ content: 'That role no longer exists. Contact an admin.', flags: MessageFlags.Ephemeral });
  }

  // ── Optimistic UI: update the picker immediately, don't wait for Discord ──
  // We optimistically flip the local role state so the user gets instant feedback,
  // then perform the actual role assignment in the background. If it fails, we
  // reconcile the UI and surface an error.
  // NOTE: intended ownership is tracked in `session.ownedRoleIds` (not the live
  // Discord member cache) because the cache only reflects reality after the
  // batched write flushes. Reading the cache would mis-toggle on rapid clicks
  // within the debounce window.
  if (!session.ownedRoleIds) session.ownedRoleIds = getOwnedRoleIds(member);

  const optimisticAction = session.ownedRoleIds.has(targetRole.id) ? 'removed' : 'added';
  const safeRoleName = safeMarkdownField(targetRole.name, 80);
  const optimisticStatus =
    optimisticAction === 'added' ? `✅ Now have **${safeRoleName}**` : `❌ Removed **${safeRoleName}**`;

  const ownedRoleIds = session.ownedRoleIds;
  if (optimisticAction === 'added') {
    ownedRoleIds.add(targetRole.id);
  } else {
    ownedRoleIds.delete(targetRole.id);
  }

  let optimisticComponents;
  if (session.searchQuery && session.searchResults) {
    const totalPages = Math.ceil(session.searchResults.length / config.BUTTONS_PER_PAGE);
    optimisticComponents = buildSearchResultComponents(session.searchPage || 1, ownedRoleIds, session.searchResults, totalPages, session.sessionId);
  } else {
    optimisticComponents = buildPickerComponents(session.page, ownedRoleIds, client._template, session.sessionId);
  }

  const optimisticEmbed = client._template.buildPickerEmbed(session.page, optimisticStatus);
  try {
    await interaction.editReply({ embeds: [optimisticEmbed], components: optimisticComponents });
  } catch (err) {
    logger.warn(`optimistic editReply thất bại (user ${interaction.user.id}): ${err.message}`);
  }
  markCooldown(interaction, client);

  // ── Batched background role assignment ──
  // Instead of one API call per click, enqueue the intent and let the
  // RoleBatcher coalesce rapid clicks into a single Discord write.
  const intent = optimisticAction === 'added'
    ? { add: targetRole.id, remove: null }
    : { add: null, remove: targetRole.id };

  const multi = client._template.multi;
  const templateRoleIds = client._template.roleIds;

  client._roleBatcher.enqueue(interaction.user.id, intent, async (addIds, removeIds) => {
    await client._roleManager.applyBatch(member, addIds, removeIds, guild, { multi, templateRoleIds, allowedRoleIds: templateRoleIds });
  }).catch(async (err) => {
    logger.error(`Thao tác role nền thất bại (user ${member.id}, role ${targetRole.id}): ${err.stack || err.message}`);
      // Reconcile: the WHOLE batch failed, so no role changed on Discord.
      // Multiple rapid clicks share one flush promise, so instead of toggling
      // per-click (which double-reverts and corrupts state), rebuild intended
      // ownership from ground truth — same pattern as handleConfirmRemove.
      session.ownedRoleIds = getOwnedRoleIds(member);
      const revertedOwned = session.ownedRoleIds;
      let revertedComponents;
      if (session.searchQuery && session.searchResults) {
          const totalPages = Math.ceil(session.searchResults.length / config.BUTTONS_PER_PAGE);
        revertedComponents = buildSearchResultComponents(session.searchPage || 1, revertedOwned, session.searchResults, totalPages, session.sessionId);
      } else {
        revertedComponents = buildPickerComponents(session.page, revertedOwned, client._template, session.sessionId);
      }
      const revertEmbed = client._template.buildPickerEmbed(
        session.page,
        `⚠️ Could not ${optimisticAction} **${safeRoleName}** — ${safeMarkdownField(err.message || 'please try again', 180)}.`
      );
      try {
        await interaction.editReply({ embeds: [revertEmbed], components: revertedComponents });
      } catch (_) {
        // Interaction may have expired; fall back to a follow-up.
        try {
          await interaction.followUp({
            content: `⚠️ Could not ${optimisticAction} **${safeRoleName}** — ${safeMarkdownField(err.message || 'please try again', 180)}.`,
            flags: MessageFlags.Ephemeral,
          });
        } catch (_) {}
      }
    });
}

async function handleRemoveAll(interaction, client, parsed) {
  const session = ensureSession(interaction, client, parsed?.sessionId || null);
  if (!session) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }
  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  if (await enforceCooldown(interaction, client)) return;

  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.warn(`deferUpdate thất bại cho remove all (user ${interaction.user.id}): ${err.message}`);
    return;
  }

  // Show confirmation dialog instead of immediate removal
  session.pendingConfirm = true;

  const confirmEmbed = {
    color: 0xE74C3C,
    title: '⚠️ Confirm Remove All Roles',
    description: 'Are you sure you want to remove **all** of your roles from this picker?\n\nThis action cannot be undone automatically.',
    footer: { text: 'Click "Yes, Remove All" to confirm.' },
    timestamp: new Date().toISOString(),
  };

  const components = buildConfirmComponents(session.sessionId);
  await interaction.editReply({ embeds: [confirmEmbed], components });
}

async function handleConfirmRemove(interaction, client, parsed) {
  const session = ensureSession(interaction, client, parsed?.sessionId || null);
  if (!session) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }
  if (!session.pendingConfirm) {
    return interaction.reply({ content: 'No pending confirmation.', flags: MessageFlags.Ephemeral });
  }

  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  if (await enforceCooldown(interaction, client)) return;

  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.warn(`deferUpdate thất bại cho confirm remove (user ${interaction.user.id}): ${err.message}`);
    return;
  }

  session.pendingConfirm = false;

  const guild = interaction.guild;
  const member = interaction.member;

  // ── Optimistic UI: show "removed" immediately, do the actual removal in background ──
  const revertedEmbed = client._template.buildPickerEmbed(session.page, '🗑️ Removing all roles…');
  const emptyOwned = new Set();
  const revertedComponents = buildPickerComponents(session.page, emptyOwned, client._template, session.sessionId);
  try {
    await interaction.editReply({ embeds: [revertedEmbed], components: revertedComponents });
  } catch (err) {
    logger.warn(`optimistic editReply thất bại cho remove-all (user ${interaction.user.id}): ${err.message}`);
  }
  markCooldown(interaction, client);

  client._roleManager
    .clearMemberRoles(member, client._template.roleIds, guild, 'Self-service role removal')
    .then((removed) => {
      const statusMsg = removed.length
        ? `🗑️ Removed all roles`
        : `You don't have any role from this picker.`;
      session.ownedRoleIds = new Set();
      const finalEmbed = client._template.buildPickerEmbed(session.page, statusMsg);
      try {
        interaction.editReply({ embeds: [finalEmbed], components: revertedComponents }).catch(() => {});
      } catch (_) {}
    })
    .catch(async (err) => {
      logger.error(`Xóa role nền thất bại (user ${member.id}): ${err.stack || err.message}`);
      const rollbackEmbed = client._template.buildPickerEmbed(
        session.page,
        `⚠️ Could not remove roles — ${safeMarkdownField(err.message || 'please try again', 180)}.`
      );
      const ownedRoleIds = getOwnedRoleIds(member);
      session.ownedRoleIds = ownedRoleIds;
      const rollbackComponents = buildPickerComponents(session.page, ownedRoleIds, client._template, session.sessionId);
      try {
        await interaction.editReply({ embeds: [rollbackEmbed], components: rollbackComponents });
      } catch (_) {
        try {
          await interaction.followUp({
            content: `⚠️ Could not remove roles — ${safeMarkdownField(err.message || 'please try again', 180)}.`,
            flags: MessageFlags.Ephemeral,
          });
        } catch (_) {}
      }
    });
}

async function handleCancelRemove(interaction, client, parsed) {
  const session = ensureSession(interaction, client, parsed?.sessionId || null);
  if (!session) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }
  if (!session.pendingConfirm) {
    return interaction.reply({ content: 'No pending confirmation.', flags: MessageFlags.Ephemeral });
  }

  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.warn(`deferUpdate thất bại cho cancel remove (user ${interaction.user.id}): ${err.message}`);
    return;
  }

  session.pendingConfirm = false;

  const page = session.page;
  const pickerEmbed = client._template.buildPickerEmbed(page, 'Removal cancelled.');
  // Prefer the session's intended ownership over the live Discord cache: role
  // writes are batched/async, so the cache lags behind and would show stale
  // toggle states (e.g. a just-added role appearing unchecked).
  if (!session.ownedRoleIds) session.ownedRoleIds = getOwnedRoleIds(interaction.member);
  const ownedRoleIds = session.ownedRoleIds;
  const components = buildPickerComponents(page, ownedRoleIds, client._template, session.sessionId);
  await interaction.editReply({ embeds: [pickerEmbed], components });
}

async function handleRoleSearch(interaction, client, parsed) {
  const session = ensureSession(interaction, client, parsed?.sessionId || null);
  if (!session) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }

  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  // Show modal for search input
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId(pickerId(session.sessionId, 'search_modal'))
    .setTitle('Search Roles');

  const searchInput = new TextInputBuilder()
    .setCustomId('picker:search_input')
    .setLabel('Enter role name or keyword')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. "Dragon", "Scythe", "Sword"')
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(new ActionRowBuilder().addComponents(searchInput));
  await interaction.showModal(modal);
}

async function handleSearchBack(interaction, client, parsed) {
  const session = ensureSession(interaction, client, parsed?.sessionId || null);
  if (!session) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }

  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.warn(`deferUpdate thất bại cho search back (user ${interaction.user.id}): ${err.message}`);
    return;
  }

  // Clear search state
  delete session.searchQuery;
  delete session.searchResults;
  delete session.searchPage;

  const page = session.page;
  const pickerEmbed = client._template.buildPickerEmbed(page);
  // Prefer the session's intended ownership over the live Discord cache: role
  // writes are batched/async, so the cache lags behind and would show stale
  // toggle states (e.g. a just-added role appearing unchecked).
  if (!session.ownedRoleIds) session.ownedRoleIds = getOwnedRoleIds(interaction.member);
  const ownedRoleIds = session.ownedRoleIds;
  const components = buildPickerComponents(page, ownedRoleIds, client._template, session.sessionId);
  await interaction.editReply({ embeds: [pickerEmbed], components });
}

async function handleSearchNav(interaction, client, parsed) {
  const session = ensureSession(interaction, client, parsed?.sessionId || null);
  if (!session) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }
  if (!session.searchResults) {
    return interaction.reply({ content: 'No search results. Please search again.', flags: MessageFlags.Ephemeral });
  }

  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  if (await enforceCooldown(interaction, client)) return;

  const totalPages = Math.ceil(session.searchResults.length / config.BUTTONS_PER_PAGE);
  const direction = parsed?.action === 'search_next' ? 1 : -1;
  const newPage = Math.max(1, Math.min(totalPages, (session.searchPage || 1) + direction));

  if (newPage === (session.searchPage || 1)) {
    try { await interaction.deferUpdate(); } catch (_) {}
    return;
  }

  session.searchPage = newPage;

  try {
    await interaction.deferUpdate();
  } catch (err) {
    logger.warn(`deferUpdate thất bại cho search nav (user ${interaction.user.id}): ${err.message}`);
    return;
  }

  // Build embed with search context
  const searchEmbed = {
    color: 0x3498DB,
    title: `Search Results: "${safeMarkdownField(session.searchQuery, 80)}"`,
    description: `Showing page ${newPage}/${totalPages} — ${session.searchResults.length} role(s) found.`,
    footer: { text: 'Click a role to toggle it.' },
    timestamp: new Date().toISOString(),
  };

  // Prefer the session's intended ownership over the live Discord cache: role
  // writes are batched/async, so the cache lags behind and would show stale
  // toggle states (e.g. a just-added role appearing unchecked).
  if (!session.ownedRoleIds) session.ownedRoleIds = getOwnedRoleIds(interaction.member);
  const ownedRoleIds = session.ownedRoleIds;
  const components = buildSearchResultComponents(newPage, ownedRoleIds, session.searchResults, totalPages, session.sessionId);
  await interaction.editReply({ embeds: [searchEmbed], components });
  markCooldown(interaction, client);
}

async function handleNavigation(interaction, client, parsed) {
  const session = ensureSession(interaction, client, parsed?.sessionId || null);
  if (!session) {
    return interaction.reply({ content: 'The role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
  }
  const err = validateSession(interaction, client);
  if (err) return interaction.reply({ content: err, flags: MessageFlags.Ephemeral });

  if (await enforceCooldown(interaction, client)) return;

  const total = client._template.totalPages();
  const direction = parsed?.action === 'next' ? 1 : -1;
  const newPage = Math.max(1, Math.min(total, session.page + direction));

  if (newPage === session.page) {
    try { await interaction.deferUpdate(); } catch (err) {
      logger.warn(`deferUpdate thất bại cho navigation (user ${interaction.user.id}): ${err.message}`);
    }
    return;
  }

  session.page = newPage;

  const embed = client._template.buildPickerEmbed(newPage);
  // Prefer the session's intended ownership over the live Discord cache: role
  // writes are batched/async, so the cache lags behind and would show stale
  // toggle states (e.g. a just-added role appearing unchecked).
  if (!session.ownedRoleIds) session.ownedRoleIds = getOwnedRoleIds(interaction.member);
  const ownedRoleIds = session.ownedRoleIds;
  const components = buildPickerComponents(newPage, ownedRoleIds, client._template, session.sessionId);
  try {
    await interaction.update({ embeds: [embed], components });
  } catch (err) {
    logger.warn(`update thất bại cho navigation (user ${interaction.user.id}): ${err.message}`);
  }
}

async function handleChangelogNav(interaction, client) {
  const parts = interaction.customId.split(':');
  const dir = parts[1];
  const pageFromButton = Number.parseInt(parts[2], 10);

  // Auto-restore data from a cached file read (mtime-invalidated) so buttons
  // stay stateless and public-safe without blocking the event loop per click.
  const entries = loadChangelogEntries();
  if (!entries.length) {
    return interaction.reply({ content: 'Changelog data not available. Run `/changelog` first.', flags: MessageFlags.Ephemeral });
  }
  if (!client._changelogBadge) {
    try {
      const { buildBadge } = require('../commands/changelog');
      client._changelogBadge = await buildBadge(client);
    } catch (_) {
      client._changelogBadge = null;
    }
  }

  const currentPage = Number.isInteger(pageFromButton) ? pageFromButton : 0;
  const newPage = dir === 'next' ? currentPage + 1 : currentPage - 1;
  if (newPage < 0 || newPage >= entries.length) {
    try { await interaction.deferUpdate(); } catch (_) {}
    return;
  }

  const embed = buildChangelogEmbed(entries, newPage, client._changelogBadge);

  const total = entries.length;
  let row = null;
  if (total > 1) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`changelog:prev:${newPage}`)
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(newPage === 0),
      new ButtonBuilder()
        .setCustomId(`changelog:next:${newPage}`)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(newPage === total - 1)
    );
  }

  try {
    await interaction.update({ embeds: [embed], components: row ? [row] : [] });
  } catch (err) {
    logger.error(`Changelog nav thất bại: ${err.message}`);
  }
}

async function handleButton(interaction, client) {
  const customId = interaction.customId;

  if (customId.startsWith('changelog:prev') || customId.startsWith('changelog:next')) {
    return handleChangelogNav(interaction, client);
  }

  if (customId === 'panel:open_picker') {
    return handleOpenPicker(interaction, client);
  }

  const parsed = parsePickerCustomId(customId);
  if (!parsed) {
    logger.warn(`Không nhận dạng được button custom_id: ${customId}`);
    try { await interaction.deferUpdate(); } catch {}
    return;
  }

  if (parsed.action === 'role') {
    return handleRoleButton(interaction, client, parsed);
  }

  // Confirm/cancel remove all
  if (parsed.action === 'remove_all') {
    return handleRemoveAll(interaction, client, parsed);
  }
  if (parsed.action === 'confirm_remove') {
    return handleConfirmRemove(interaction, client, parsed);
  }
  if (parsed.action === 'cancel_remove') {
    return handleCancelRemove(interaction, client, parsed);
  }

  // Search
  if (parsed.action === 'search') {
    return handleRoleSearch(interaction, client, parsed);
  }
  if (parsed.action === 'search_back') {
    return handleSearchBack(interaction, client, parsed);
  }
  if (parsed.action === 'search_prev' || parsed.action === 'search_next') {
    return handleSearchNav(interaction, client, parsed);
  }

  // Navigation
  if (parsed.action === 'prev' || parsed.action === 'next') {
    return handleNavigation(interaction, client, parsed);
  }

  logger.warn(`Không nhận dạng được button custom_id: ${customId}`);
  try { await interaction.deferUpdate(); } catch {}
}

module.exports = { handleButton };
