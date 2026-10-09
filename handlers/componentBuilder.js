const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { BUTTONS_PER_PAGE } = require('../config/config');

function pickerId(sessionId, action, extra = '') {
  return sessionId ? `picker:${sessionId}:${action}${extra}` : `picker:${action}${extra}`;
}

function parsePickerCustomId(customId) {
  const parts = String(customId || '').split(':');
  if (parts[0] !== 'picker') return null;
  const legacyActions = new Set([
    'role', 'remove_all', 'confirm_remove', 'cancel_remove', 'search',
    'search_modal', 'search_back', 'search_prev', 'search_next', 'prev', 'next', 'page',
  ]);
  if (legacyActions.has(parts[1])) {
    return { sessionId: null, action: parts[1], args: parts.slice(2) };
  }
  return { sessionId: parts[1] || null, action: parts[2] || null, args: parts.slice(3) };
}

function buildPickerComponents(page, ownedRoleIds, template, sessionId = null) {
  const rows = [];
  const pageRoles = template.pageRoles(page);

  for (let i = 0; i < pageRoles.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const entry of pageRoles.slice(i, i + 5)) {
      const hasRole = ownedRoleIds.has(entry.id);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(pickerId(sessionId, 'role', `:${entry.id}`))
          .setLabel(hasRole ? `✓ ${entry.label}` : entry.label)
          .setStyle(hasRole ? ButtonStyle.Success : ButtonStyle.Danger)
      );
    }
    rows.push(row);
  }

  const bottomRow = new ActionRowBuilder();
  bottomRow.addComponents(
    new ButtonBuilder()
      .setCustomId(pickerId(sessionId, 'remove_all'))
      .setLabel('Remove All Roles')
      .setEmoji({ id: '1528997120433193132', name: 'warning' })
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(pickerId(sessionId, 'search'))
      .setLabel('🔍 Search')
      .setStyle(ButtonStyle.Secondary)
  );

  const total = template.totalPages();
  if (total > 1) {
    bottomRow.addComponents(
        new ButtonBuilder()
        .setCustomId(pickerId(sessionId, 'prev'))
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
        new ButtonBuilder()
        .setCustomId(pickerId(sessionId, 'page'))
        .setLabel(`${page}/${total}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
        new ButtonBuilder()
        .setCustomId(pickerId(sessionId, 'next'))
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= total)
    );
  }

  rows.push(bottomRow);
  return rows;
}

function buildSearchResultComponents(page, ownedRoleIds, results, totalPages, sessionId = null) {
  const rows = [];
  const start = (page - 1) * BUTTONS_PER_PAGE;
  const pageResults = results.slice(start, start + BUTTONS_PER_PAGE);

  for (let i = 0; i < pageResults.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const entry of pageResults.slice(i, i + 5)) {
      const hasRole = ownedRoleIds.has(entry.id);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(pickerId(sessionId, 'role', `:${entry.id}`))
          .setLabel(hasRole ? `✓ ${entry.label}` : entry.label)
          .setStyle(hasRole ? ButtonStyle.Success : ButtonStyle.Danger)
      );
    }
    rows.push(row);
  }

  const navRow = new ActionRowBuilder();
  if (totalPages > 1) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(pickerId(sessionId, 'search_prev'))
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(pickerId(sessionId, 'search_back'))
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(pickerId(sessionId, 'search_next'))
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages)
    );
  } else {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(pickerId(sessionId, 'search_back'))
        .setLabel('← Back to All Roles')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  rows.push(navRow);
  return rows;
}

function buildConfirmComponents(sessionId = null) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(pickerId(sessionId, 'confirm_remove'))
        .setLabel('✅ Yes, Remove All')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(pickerId(sessionId, 'cancel_remove'))
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

module.exports = { buildPickerComponents, buildSearchResultComponents, buildConfirmComponents, pickerId, parsePickerCustomId };
