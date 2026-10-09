const fs = require('fs');
const path = require('path');
const { LOG_DIR, LOG_LEVEL } = require('./config');

const LOG_FILE = path.join(LOG_DIR, 'bot.log');
const MAX_BYTES = 1024 * 1024;
const BACKUP_COUNT = 3;

fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[LOG_LEVEL] !== undefined ? LEVELS[LOG_LEVEL] : LEVELS.info;

let stream = null;
let bytesWritten = 0;

function getStream() {
  if (!stream) {
    stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    bytesWritten = 0;
  }
  return stream;
}

function rotate() {
  if (stream) {
    stream.end();
    stream = null;
  }
  for (let i = BACKUP_COUNT - 1; i >= 0; i--) {
    const oldPath = i === 0 ? LOG_FILE : LOG_FILE + '.' + i;
    const newPath = LOG_FILE + '.' + (i + 1);
    if (fs.existsSync(oldPath)) {
      try { fs.renameSync(oldPath, newPath); } catch (rotateErr) {
        // Write straight to stderr to avoid re-entering write() (which could
        // recurse into rotate() again).
        process.stderr.write(`LOG ROTATION RENAME FAILED: ${rotateErr && rotateErr.message}\n`);
      }
    }
  }
  bytesWritten = 0;
}

function vietnamTimestamp() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function safeStdout(line) {
  try {
    process.stdout.write(line);
  } catch (err) {
    // EPIPE happens when the parent pipe (e.g. npm wrapper) closes.
    // Swallow it — never let logging crash the bot.
    if (err && err.code === 'EPIPE') return;
    process.stderr.write(`STDOUT WRITE FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

const COLORS = { error: '31', warn: '33', info: '36', debug: '90' };

function write(level, msg) {
  if (LEVELS[level] === undefined || LEVELS[level] > currentLevel) return;
  const ts = vietnamTimestamp();
  const color = COLORS[level] || '0';
  const colored = `\x1b[${color}m${level.toUpperCase().padEnd(7)}\x1b[0m`;
  const line = `${ts} | ${colored} | Zzz | ${msg}\n`;
  safeStdout(line);
  try {
    const buf = Buffer.from(line, 'utf-8');
    // Rotate before write if this line would exceed the limit
    if (bytesWritten + buf.length > MAX_BYTES) {
      rotate();
    }
    const s = getStream();
    if (s.listenerCount('error') === 0) {
      s.on('error', (err) => {
        if (err && err.code === 'EPIPE') return; // ignore broken-pipe on log file too
      });
    }
    s.write(line, 'utf-8');
    bytesWritten += buf.length;
  } catch (err) {
    process.stderr.write(`LOG WRITE FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function flush() {
  return new Promise((resolve) => {
    if (stream) {
      stream.end(resolve);
      stream = null;
    } else {
      resolve();
    }
  });
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

module.exports = {
  error: (msg, ...args) => write('error', args.length ? msg + ' ' + args.map(safeStringify).join(' ') : msg),
  warn: (msg, ...args) => write('warn', args.length ? msg + ' ' + args.map(safeStringify).join(' ') : msg),
  info: (msg, ...args) => write('info', args.length ? msg + ' ' + args.map(safeStringify).join(' ') : msg),
  debug: (msg, ...args) => write('debug', args.length ? msg + ' ' + args.map(safeStringify).join(' ') : msg),
  flush,
};
