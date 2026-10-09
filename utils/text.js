const { escapeMarkdown } = require('discord.js');

function cleanControlChars(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n');
}

function neutralizeMentions(value) {
  return cleanControlChars(value)
    .replace(/@everyone/g, '@\u200beveryone')
    .replace(/@here/g, '@\u200bhere')
    .replace(/<@/g, '<@\u200b')
    .replace(/<@&/g, '<@\u200b&');
}

function safeMarkdown(value) {
  return escapeMarkdown(neutralizeMentions(value));
}

function truncate(value, max = 1024, suffix = '…') {
  const s = cleanControlChars(value);
  if (s.length <= max) return s || '—';
  if (max <= suffix.length) return suffix.slice(0, max);
  return s.slice(0, max - suffix.length) + suffix;
}

function safeField(value, max = 1024) {
  return truncate(neutralizeMentions(value), max);
}

function safeMarkdownField(value, max = 1024) {
  return truncate(safeMarkdown(value), max);
}

function joinLimited(items, separator = '\n', max = 1024, moreFormatter = n => `… and ${n} more`) {
  const parts = items.map(v => cleanControlChars(v));
  const out = [];
  let len = 0;
  for (let i = 0; i < parts.length; i++) {
    const next = parts[i];
    const addLen = (out.length ? separator.length : 0) + next.length;
    const remaining = parts.length - i;
    const more = remaining > 0 ? moreFormatter(remaining) : '';
    const moreLen = more ? separator.length + more.length : 0;
    if (out.length && len + addLen + moreLen > max) {
      out.push(moreFormatter(parts.length - i));
      break;
    }
    if (!out.length && next.length > max) {
      out.push(truncate(next, max));
      break;
    }
    out.push(next);
    len += addLen;
  }
  return out.join(separator) || '—';
}

module.exports = {
  cleanControlChars,
  neutralizeMentions,
  safeMarkdown,
  safeField,
  safeMarkdownField,
  truncate,
  joinLimited,
};
