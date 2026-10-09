const fs = require('fs');
const path = require('path');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { BUTTONS_PER_PAGE, BOT_VERSION } = require('../config/config');
const { VALID_STYLES } = require('./styles');
const logger = require('../config/logger');

const DANGEROUS_ROLE_PERMS = [
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.ModerateMembers,
  PermissionsBitField.Flags.ManageMessages,
  PermissionsBitField.Flags.ManageWebhooks,
  PermissionsBitField.Flags.ManageThreads,
  PermissionsBitField.Flags.MentionEveryone,
].filter(Boolean);

class RoleTemplateLoader {
  constructor(filepath) {
    this.filepath = filepath;
    this.data = {};
    this.roles = [];
    this.embedConfig = {};
    this.templateName = '';
    this._labelMap = {};
    this._idsSet = new Set();
    this._roleIds = [];
    this._cachedPages = 0;
    this._cachedColor = 0;
    this._multi = false;
  }

  load(guild) {
    if (!fs.existsSync(this.filepath)) {
      throw new Error(`Template file not found: ${this.filepath}`);
    }

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.filepath, 'utf-8'));
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`JSON syntax error in ${this.filepath}: ${err.message}`);
      }
      throw err;
    }

    this._validateStructure(raw);

    const color = Number(raw.embed.color);
    if (isNaN(color) || color > 0xFFFFFF || color < 0) {
      throw new Error(`Embed color ${raw.embed.color} is invalid or exceeds Discord's limit (0xFFFFFF = 16777215).`);
    }

    const filtered = [];
    const labelMap = {};
    const seenIds = new Set();
    const seenLabels = new Set();
    for (const entry of raw.roles) {
      const roleId = String(entry.id);
      const guildRole = guild.roles.cache.get(roleId);
      if (!guildRole) {
        throw new Error(`Role ID ${roleId} (label='${entry.label}') not found in this guild.`);
      }
      if (guildRole.name === '@everyone') {
        logger.warn('Bỏ qua @everyone trong template.');
        continue;
      }
      if (guildRole.managed) {
        throw new Error(`Role '${guildRole.name}' is managed by an integration/bot and cannot be self-assigned.`);
      }
      const dangerous = DANGEROUS_ROLE_PERMS.filter(p => guildRole.permissions.has(p));
      if (dangerous.length) {
        throw new Error(`Role '${guildRole.name}' has dangerous permissions and cannot be used in a public self-assign template.`);
      }
      const labelKey = entry.label.toLowerCase();
      if (seenIds.has(roleId)) {
        throw new Error(`Duplicate role id '${roleId}' in template.`);
      }
      if (seenLabels.has(labelKey)) {
        throw new Error(`Duplicate role label '${entry.label}' in template.`);
      }
      const styleKey = entry.style.toLowerCase();
      if (!VALID_STYLES[styleKey]) {
        throw new Error(`Invalid style '${entry.style}' for role '${entry.label}'. Allowed: ${Object.keys(VALID_STYLES)}`);
      }
      const obj = { id: roleId, label: entry.label, style: styleKey };
      filtered.push(obj);
      labelMap[labelKey] = obj;
      seenIds.add(roleId);
      seenLabels.add(labelKey);
    }

    if (!filtered.length) {
      throw new Error('Template has no valid roles after filtering.');
    }

    this.data = raw;
    this.roles = filtered;
    this.embedConfig = raw.embed;
    this.templateName = raw.template_name;
    this._labelMap = labelMap;
    this._idsSet = new Set(filtered.map(e => e.id));
    this._roleIds = filtered.map(e => e.id); // cached array for role-manager calls
    // Optional multi-select mode: clicking a role adds without removing others.
    this._multi = raw.multi === true;
    this._cachedPages = Math.max(1, Math.ceil(filtered.length / BUTTONS_PER_PAGE));
    this._cachedColor = Number(raw.embed.color);

    logger.info(`Template '${this.templateName}' đã tải — ${filtered.length} role, ${this._cachedPages} trang.`);
  }

  _validateStructure(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Template root must be a JSON object.');
    }
    const ALLOWED_TOP_KEYS = new Set(['template_name', 'embed', 'roles', 'multi']);
    for (const key of Object.keys(raw)) {
      if (!ALLOWED_TOP_KEYS.has(key)) throw new Error(`Unknown top-level key: '${key}'`);
    }
    for (const key of ['template_name', 'embed', 'roles']) {
      if (!(key in raw)) throw new Error(`Template missing top-level key: '${key}'`);
    }
    if (!raw.embed || typeof raw.embed !== 'object' || Array.isArray(raw.embed)) {
      throw new Error("Template 'embed' must be an object.");
    }
    const ALLOWED_EMBED_KEYS = new Set(['title', 'description', 'color', 'footer']);
    for (const key of Object.keys(raw.embed)) {
      if (!ALLOWED_EMBED_KEYS.has(key)) throw new Error(`Unknown embed key: '${key}'`);
    }
    for (const key of ['title', 'description', 'color', 'footer']) {
      if (!(key in raw.embed)) throw new Error(`Template embed section missing key: '${key}'`);
    }
    if (String(raw.embed.title).length > 256) throw new Error('Template embed title is too long (max 256).');
    if (String(raw.embed.description).length > 3800) throw new Error('Template embed description is too long (max 3800).');
    if (String(raw.embed.footer).length > 2048) throw new Error('Template embed footer is too long (max 2048).');
    if (!Array.isArray(raw.roles) || !raw.roles.length) {
      throw new Error("'roles' must be a non-empty list.");
    }
    if ('multi' in raw && typeof raw.multi !== 'boolean') {
      throw new Error("'multi' must be a boolean (true/false) when present.");
    }
    const ALLOWED_ROLE_KEYS = new Set(['id', 'label', 'style']);
    raw.roles.forEach((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        throw new Error(`Role entry #${i} must be an object.`);
      }
      for (const key of Object.keys(r)) {
        if (!ALLOWED_ROLE_KEYS.has(key)) throw new Error(`Role entry #${i} has unknown key: '${key}'`);
      }
      for (const field of ['id', 'label', 'style']) {
        if (!(field in r)) throw new Error(`Role entry #${i} missing field '${field}'.`);
      }
      if (!String(r.id).trim()) throw new Error(`Role entry #${i} has empty 'id'.`);
      if (!String(r.label).trim()) throw new Error(`Role entry #${i} has empty 'label'.`);
      if (String(r.label).length > 80) throw new Error(`Role entry #${i} label is too long (max 80).`);
      if (!String(r.style).trim()) throw new Error(`Role entry #${i} has empty 'style'.`);
    });
  }

  totalPages() { return this._cachedPages; }

  pageRoles(page) {
    const start = (page - 1) * BUTTONS_PER_PAGE;
    return this.roles.slice(start, start + BUTTONS_PER_PAGE);
  }

  roleLabels() {
    return Object.keys(this._labelMap).sort();
  }

  findRoleByLabel(label) {
    return this._labelMap[String(label || '').toLowerCase()] || null;
  }

  hasRoleId(roleId) { return this._idsSet.has(String(roleId)); }

  get roleIds() { return this._roleIds; } // cached array, no per-call allocation
  get multi() { return this._multi; } // true => multi-select mode

  buildPublicEmbed() {
    const ec = this.embedConfig;
    return new EmbedBuilder()
      .setTitle(ec.title)
      .setDescription(`${ec.description}\n\nClick **Pick Your Role** below to open your personal role picker.`)
      .setColor(this._cachedColor)
      .setFooter({ text: `${ec.footer} | Bot v${BOT_VERSION}` });
  }

  buildPickerEmbed(page, resultMsg = '') {
    const ec = this.embedConfig;
    const total = this.totalPages();
    const title = total === 1 ? ec.title : `${ec.title}  |  Page ${page} of ${total}`;
    const lines = [];
    if (resultMsg) lines.push(resultMsg, '');
    lines.push(page === 1 ? ec.description : `*(page ${page} of ${total})*`);
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(lines.join('\n'))
      .setColor(this._cachedColor)
      .setFooter({ text: `${ec.footer} | Bot v${BOT_VERSION} | Only you can see this` });
  }
}

module.exports = RoleTemplateLoader;
