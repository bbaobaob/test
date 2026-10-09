const { SlashCommandBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../config/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('export')
    .setDescription('[Admin] Download the stats database as a JSON file.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction, { client }) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `stats_${ts}.json`;
    const tmpPath = path.join(os.tmpdir(), `zzz-export-${process.pid}-${Date.now()}.json`);

    try {
      // Stream to a temp file instead of building one giant JSON string in RAM.
      const { path: writtenPath, total, truncated } = client._stats.exportJsonStream(tmpPath, {
        maxRows: 50_000,
      });
      const buf = fs.readFileSync(writtenPath);
      try { fs.unlinkSync(writtenPath); } catch (_) {}
      const attachment = new AttachmentBuilder(buf, { name: filename });
      const content = `Stats Export\nAssignments: \`${total}\` | Unique users: \`${client._stats.uniqueUsers}\`${truncated ? ' | ⚠️ truncated at 50k rows' : ''}`;
      await interaction.editReply({ content, files: [attachment] });
    } catch (err) {
      logger.error(`Export thất bại: ${err.message}`);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      await interaction.editReply('Could not serialize stats. Check bot logs.');
    }
  }
};
