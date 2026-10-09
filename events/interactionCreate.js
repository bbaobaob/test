const { PermissionsBitField, MessageFlags } = require('discord.js');
const { GUILD_ID, BUTTONS_PER_PAGE, PUBLIC_COMMAND_COOLDOWN_SECONDS, PICKER_TIMEOUT } = require('../config/config');
const logger = require('../config/logger');
const { parsePickerCustomId } = require('../handlers/componentBuilder');
const { safeMarkdownField } = require('../utils/text');

async function safeInteractionError(interaction, message = 'An unexpected error occurred. Please try again.') {
  try {
    if (interaction.deferred && !interaction.replied) {
      return await interaction.editReply({ content: message, embeds: [], components: [], files: [] });
    }
    if (interaction.replied) {
      return await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    }
    return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  } catch (_) {}
}

// Read-only check: returns remaining seconds if the user is still on cooldown.
// The timestamp is only recorded by markPublicCooldown AFTER the command runs,
// so a failing command doesn't burn the user's cooldown.
function publicCooldownRemaining(interaction, client) {
  const publicCooldowns = client._publicCooldowns || (client._publicCooldowns = new Map());
  const key = `${interaction.commandName}:${interaction.user.id}`;
  const now = Date.now();
  const last = publicCooldowns.get(key) || 0;
  const ttl = PUBLIC_COMMAND_COOLDOWN_SECONDS * 1000;
  if (now - last < ttl) return Math.ceil((ttl - (now - last)) / 1000);
  return 0;
}

function markPublicCooldown(interaction, client) {
  const publicCooldowns = client._publicCooldowns || (client._publicCooldowns = new Map());
  publicCooldowns.set(`${interaction.commandName}:${interaction.user.id}`, Date.now());
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      await executeInteraction(interaction, client);
    } catch (err) {
      logger.error(`Lỗi interactionCreate ngoài dự kiến: ${err.stack || err.message}`);
      await safeInteractionError(interaction);
    }
  },
};

async function executeInteraction(interaction, client) {
  if (interaction.isAutocomplete()) {
    const cmd = client._commands.get(interaction.commandName);
    if (cmd && cmd.autocomplete) {
      try {
        await cmd.autocomplete(interaction, client);
      } catch (err) {
        logger.error(`Lỗi autocomplete cho ${interaction.commandName}: ${err.message}`);
      }
    }
    return;
  }

  if (interaction.isButton()) {
    return client._handleButton(interaction);
  }

  const modalParsed = interaction.isModalSubmit() ? parsePickerCustomId(interaction.customId) : null;
  if (interaction.isModalSubmit() && modalParsed?.action === 'search_modal') {
    try {
      const { buildSearchResultComponents } = require('../handlers/componentBuilder');

      if (!interaction.guild || !interaction.member) {
        return interaction.reply({ content: 'Could not verify your server membership. Please try again.', flags: MessageFlags.Ephemeral });
      }

      const query = interaction.fields.getTextInputValue('picker:search_input').trim().toLowerCase();
      if (!query) {
        return interaction.reply({ content: 'Please enter a search term.', flags: MessageFlags.Ephemeral });
      }

      let session = client._pickerManager.get(interaction.user.id, modalParsed.sessionId || null);
      if (!session) {
        if (!client._template || !client._template.roles.length) {
          return interaction.reply({ content: 'Role list is not loaded yet. Ask an admin to run `/deploy`.', flags: MessageFlags.Ephemeral });
        }
        session = {
          userId: interaction.user.id,
          sessionId: modalParsed.sessionId || null,
          page: 1,
          createdAt: Date.now(),
          timeout: PICKER_TIMEOUT,
          ownedRoleIds: new Set(interaction.member.roles.cache.map(r => r.id)),
        };
        client._pickerManager.set(interaction.user.id, session);
      }

      const results = client._template.roles.filter(entry => {
        if (entry.label.toLowerCase().includes(query)) return true;
        const guildRole = interaction.guild.roles.cache.get(entry.id);
        return guildRole ? guildRole.name.toLowerCase().includes(query) : false;
      });

      if (!results.length) {
        return interaction.reply({ content: `No roles found matching **"${safeMarkdownField(query, 80)}"**. Try a different term.`, flags: MessageFlags.Ephemeral });
      }

      session.searchQuery = query;
      session.searchResults = results;
      session.searchPage = 1;

      const totalPages = Math.ceil(results.length / BUTTONS_PER_PAGE);
      const searchEmbed = {
        color: 0x3498DB,
        title: `Search Results: "${safeMarkdownField(query, 80)}"`,
        description: `Showing page 1/${totalPages} — ${results.length} role(s) found.\nClick a role to toggle it, or **← Back** to return.`,
        footer: { text: 'Click a role to toggle it.' },
        timestamp: new Date().toISOString(),
      };

      try {
        await interaction.deferUpdate();
      } catch (err) {
        logger.warn(`deferUpdate thất bại cho search modal (user ${interaction.user.id}): ${err.message}`);
        return;
      }

      const ownedRoleIds = new Set(interaction.member.roles.cache.map(r => r.id));
      session.ownedRoleIds = ownedRoleIds;
      const components = buildSearchResultComponents(1, ownedRoleIds, results, totalPages, session.sessionId);
      await interaction.editReply({ embeds: [searchEmbed], components });
      return;
    } catch (err) {
      logger.error(`Lỗi search modal (user ${interaction.user.id}): ${err.stack || err.message}`);
      await safeInteractionError(interaction, 'Something went wrong while searching. Please try again.');
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const cmd = client._commands.get(interaction.commandName);
  if (!cmd) return;

  const guild = interaction.guild;
  if (!guild || interaction.guildId !== GUILD_ID) {
    return interaction.reply({ content: 'This bot only operates in its configured guild.', flags: MessageFlags.Ephemeral });
  }

  // Public commands declare their own `public: true` flag — no hardcoded list.
  // A missing flag means admin-only, so new public commands can't silently
  // become admin-gated.
  const isPublic = cmd.public === true;

  try {
    if (!isPublic) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      const wait = publicCooldownRemaining(interaction, client);
      if (wait > 0) {
        return interaction.reply({ content: `Please wait ${wait}s before using this command again.`, flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply();
    }
  } catch {
    return;
  }

  if (!interaction.member) {
    return interaction.editReply('Could not verify your server membership. Please try again.');
  }

  const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
  if (!isAdmin && !isPublic) {
    return interaction.editReply('You must be a server **Administrator** to use this command.');
  }

  const startTime = Date.now();
  const botMember = guild.members.me;

  try {
    await cmd.execute(interaction, {
      client,
      guild,
      botMember,
      template: client._template,
      state: client._state,
      startTime: client._startTime,
    });
    client._metrics.incr(interaction.commandName);
    markPublicCooldown(interaction, client);
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > 0.5) {
      client._metrics.recordTiming(elapsed);
    }
  } catch (err) {
    client._metrics.error(interaction.commandName);
    logger.error(`Lỗi lệnh ${interaction.commandName}: ${err.stack || err.message}`);
    await safeInteractionError(interaction, 'An unexpected error occurred. Check bot logs for details.');
  }
}
