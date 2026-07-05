const { PermissionsBitField, MessageFlags } = require('discord.js');
const { GUILD_ID } = require('../config/config');
const logger = require('../config/logger');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (interaction.isAutocomplete()) {
      const cmd = client._commands.get(interaction.commandName);
      if (cmd && cmd.autocomplete) {
        try {
          await cmd.autocomplete(interaction, client);
        } catch (err) {
          logger.error(`Autocomplete error for ${interaction.commandName}: ${err.message}`);
        }
      }
      return;
    }

    if (interaction.isButton()) {
      return client._handleButton(interaction);
    }

    if (!interaction.isChatInputCommand()) return;

    const cmd = client._commands.get(interaction.commandName);
    if (!cmd) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild || interaction.guildId !== GUILD_ID) {
      return interaction.followUp('This bot only operates in its configured guild.');
    }

    if (!interaction.member) {
      return interaction.followUp('Could not verify your server membership. Please try again.');
    }

    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      return interaction.followUp('You must be a server **Administrator** to use this command.');
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
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > 0.5) {
        client._metrics.recordTiming(elapsed);
      }
    } catch (err) {
      client._metrics.error(interaction.commandName);
      logger.error(`Command ${interaction.commandName} error: ${err.stack || err.message}`);
      try {
        await interaction.followUp('An unexpected error occurred. Check bot logs for details.');
      } catch {}
    }
  }
};
