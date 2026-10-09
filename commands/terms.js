const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('terms')
    .setDescription('View the Terms of Service and Privacy Policy.'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('📜 Terms of Service & Privacy Policy')
      .setColor(0x3498DB)
      .setDescription(
        'By using **Zzz**, you agree to the following terms:\n\n' +
        '**1. Acceptance**\n' +
        'Using this bot means you accept these terms. If you disagree, do not use the bot.\n\n' +
        '**2. Use of Service**\n' +
        '• The bot is provided "as is" without warranties.\n' +
        '• You may not use the bot for illegal or malicious purposes.\n' +
        '• We reserve the right to restrict access at any time.\n\n' +
        '**3. Data Collection**\n' +
        '• We store role assignment history (user ID, role name, timestamp) for analytics.\n' +
        '• No messages, DMs, or personal conversations are logged.\n' +
        '• Data is stored locally and not shared with third parties.\n\n' +
        '**4. User Responsibility**\n' +
        '• You are responsible for your interactions while using the bot.\n' +
        '• Server admins control role assignments — the bot only executes configured actions.\n\n' +
        '**5. Contact**\n' +
        'For questions, contact the server administrator.\n\n' +
        '*Last updated: July 2026*'
      )
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
