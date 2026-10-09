const zlib = require('node:zlib');

// ── CRC32 (table-based) ──────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function pngSignature() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

// ── Tiny drawing helpers (RGB or RGBA raster) ────────
function makeRaster(w, h, rgba = false) {
  // row-major pixels; RGB (3bpp) filled white, RGBA (4bpp) fully transparent
  const bpp = rgba ? 4 : 3;
  const data = rgba ? Buffer.alloc(w * h * bpp, 0x00) : Buffer.alloc(w * h * bpp, 0xff);
  return { w, h, data, bpp };
}

function setPixel(r, x, y, r8, g8, b8) {
  if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
  const i = (y * r.w + x) * r.bpp;
  r.data[i] = r8;
  r.data[i + 1] = g8;
  r.data[i + 2] = b8;
  if (r.bpp === 4) r.data[i + 3] = 0xff;
}

function blendPixel(r, x, y, r8, g8, b8, alpha) {
  if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
  const i = (y * r.w + x) * r.bpp;
  r.data[i] = Math.round(r.data[i] * (1 - alpha) + r8 * alpha);
  r.data[i + 1] = Math.round(r.data[i + 1] * (1 - alpha) + g8 * alpha);
  r.data[i + 2] = Math.round(r.data[i + 2] * (1 - alpha) + b8 * alpha);
  if (r.bpp === 4) r.data[i + 3] = 0xff;
}

function drawLine(r, x0, y0, x1, y1, r8, g8, b8) {
  // Bresenham
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    setPixel(r, x0, y0, r8, g8, b8);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

function hexToInt(hex) {
  if (typeof hex === 'number') return hex;
  return parseInt(String(hex).replace('#', ''), 16);
}

function rgb(hex) {
  const v = hexToInt(hex);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * Render a line/area trend chart to a PNG Buffer.
 * @param {object} opts
 * @param {string} opts.title
 * @param {Array<{name:string,color:number|string,points:number[]}>} opts.series
 * @param {number} [opts.width=800]
 * @param {number} [opts.height=400]
 * @param {string} [opts.xLabel]
 */
function renderTrendChart({ title = 'Role Trends', series = [], width = 800, height = 400, xLabel = 'time →' }) {
  const r = makeRaster(width, height);
  const padL = 56, padR = 20, padT = 48, padB = 40;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const bg = [255, 255, 255];
  const grid = [225, 228, 234];
  const axis = [120, 128, 140];
  const text = [70, 78, 92];

  // background
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) setPixel(r, x, y, bg[0], bg[1], bg[2]);

  // Determine global min/max across all series
  let min = Infinity, max = -Infinity;
  for (const s of series) for (const v of s.points) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min)) { min = 0; max = 1; }
  if (min === max) { max = min + 1; min = Math.max(0, min - 1); }
  // pad range a touch
  const range = max - min;
  min = Math.max(0, min - range * 0.1);
  max = max + range * 0.1;
  const span = max - min;

  // grid + y labels (5 ticks)
  const ticks = 5;
  for (let t = 0; t <= ticks; t++) {
    const y = padT + Math.round((t / ticks) * plotH);
    drawLine(r, padL, y, padL + plotW, y, grid[0], grid[1], grid[2]);
    const val = Math.round(max - (t / ticks) * span);
    // crude label (digits)
    drawText(r, padL - 8 - (String(val).length * 7), y - 4, String(val), text[0], text[1], text[2]);
  }
  // axes
  drawLine(r, padL, padT, padL, padT + plotH, axis[0], axis[1], axis[2]);
  drawLine(r, padL, padT + plotH, padL + plotW, padT + plotH, axis[0], axis[1], axis[2]);

  // x label
  drawText(r, padL + plotW - (xLabel.length * 7), padT + plotH + 18, xLabel, text[0], text[1], text[2]);

  // plot each series
  const n = series.length ? Math.max(...series.map(s => s.points.length)) : 0;
  for (const s of series) {
    const pts = s.points;
    const [cr, cg, cb] = rgb(s.color);
    if (pts.length === 0) continue;
    const stepX = n > 1 ? plotW / (n - 1) : 0;
    // area fill (semi-transparent) when single or first
    if (pts.length > 1) {
      for (let i = 0; i < pts.length - 1; i++) {
        const x0 = padL + i * stepX;
        const x1 = padL + (i + 1) * stepX;
        const y0 = padT + plotH - ((pts[i] - min) / span) * plotH;
        const y1 = padT + plotH - ((pts[i + 1] - min) / span) * plotH;
        // light vertical fill down to baseline
        const xL = Math.round(x0), xR = Math.round(x1);
        for (let x = xL; x <= xR; x++) {
          const yTop = Math.round(x === xL ? y0 : (x === xR ? y1 : y0 + (y1 - y0) * ((x - xL) / (xR - xL || 1))));
          for (let y = Math.round(yTop); y <= padT + plotH; y++) {
            blendPixel(r, x, y, cr, cg, cb, 0.10);
          }
        }
      }
    }
    // line
    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = padL + i * stepX, x1 = padL + (i + 1) * stepX;
      const y0 = padT + plotH - ((pts[i] - min) / span) * plotH;
      const y1 = padT + plotH - ((pts[i + 1] - min) / span) * plotH;
      drawLine(r, x0, y0, x1, y1, cr, cg, cb);
    }
    // last point dot
    const lx = padL + (pts.length - 1) * stepX;
    const ly = padT + plotH - ((pts[pts.length - 1] - min) / span) * plotH;
    setPixel(r, Math.round(lx), Math.round(ly), cr, cg, cb);
  }

  // title
  drawText(r, padL, 24, title, text[0], text[1], text[2], true);

  // legend (if >1 series)
  if (series.length > 1) {
    let lx = padL + 4;
    const ly = padT - 14;
    for (const s of series) {
      const [cr, cg, cb] = rgb(s.color);
      drawText(r, lx, ly, '■', cr, cg, cb);
      lx += 14;
      drawText(r, lx, ly, s.name, text[0], text[1], text[2]);
      lx += s.name.length * 7 + 14;
    }
  }

  return rasterToPng(r);
}

// ── Raster -> PNG (24-bit RGB or 32-bit RGBA, zlib deflate) ────────
function rasterToPng(r) {
  const { w, h, data, bpp = 3 } = r;
  // add filter byte (0) per row
  const stride = w * bpp + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    data.copy(raw, y * stride + 1, y * w * bpp, (y + 1) * w * bpp);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;              // bit depth
  ihdr[9] = bpp === 4 ? 6 : 2; // color type: 2 = truecolor RGB, 6 = truecolor RGBA
  ihdr[10] = 0;             // compression
  ihdr[11] = 0;             // filter
  ihdr[12] = 0;             // interlace

  return Buffer.concat([
    pngSignature(),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Minimal bitmap font (5x7) for ASCII labels ──────
// We embed a compact glyph set for digits + A-Z + a few symbols.
const FONT = buildFont();

function drawText(r, x, y, str, r8, g8, b8, bold = false) {
  str = String(str);
  let cx = x;
  for (const ch of str) {
    const glyph = FONT[ch.toUpperCase()] || FONT['?'];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row] & (1 << (4 - col))) {
          setPixel(r, cx + col, y + row, r8, g8, b8);
          if (bold) { setPixel(r, cx + col + 1, y + row, r8, g8, b8); }
        }
      }
    }
    cx += 6;
  }
}

function buildFont() {
  // 5x7 glyphs as 7 rows of 5-bit numbers (MSB = leftmost)
  const G = {};
  const def = (ch, rows) => { G[ch] = rows; };
  def(' ', [0,0,0,0,0,0,0]);
  def('A', [0x0e,0x11,0x11,0x1f,0x11,0x11,0x11]);
  def('B', [0x1f,0x11,0x11,0x1f,0x11,0x11,0x1f]);
  def('C', [0x0e,0x11,0x10,0x10,0x10,0x11,0x0e]);
  def('D', [0x1f,0x11,0x11,0x11,0x11,0x11,0x1f]);
  def('E', [0x1f,0x10,0x10,0x1f,0x10,0x10,0x1f]);
  def('F', [0x1f,0x10,0x10,0x1f,0x10,0x10,0x10]);
  def('G', [0x0e,0x11,0x10,0x13,0x11,0x11,0x0f]);
  def('H', [0x11,0x11,0x11,0x1f,0x11,0x11,0x11]);
  def('I', [0x0e,0x04,0x04,0x04,0x04,0x04,0x0e]);
  def('J', [0x07,0x02,0x02,0x02,0x12,0x12,0x0c]);
  def('K', [0x11,0x12,0x14,0x18,0x14,0x12,0x11]);
  def('L', [0x10,0x10,0x10,0x10,0x10,0x10,0x1f]);
  def('M', [0x11,0x1b,0x15,0x15,0x11,0x11,0x11]);
  def('N', [0x11,0x19,0x15,0x15,0x13,0x11,0x11]);
  def('O', [0x0e,0x11,0x11,0x11,0x11,0x11,0x0e]);
  def('P', [0x1f,0x11,0x11,0x1f,0x10,0x10,0x10]);
  def('Q', [0x0e,0x11,0x11,0x11,0x15,0x12,0x0d]);
  def('R', [0x1f,0x11,0x11,0x1f,0x14,0x12,0x11]);
  def('S', [0x0e,0x11,0x10,0x0e,0x01,0x11,0x0e]);
  def('T', [0x1f,0x04,0x04,0x04,0x04,0x04,0x04]);
  def('U', [0x11,0x11,0x11,0x11,0x11,0x11,0x0e]);
  def('V', [0x11,0x11,0x11,0x11,0x11,0x0a,0x04]);
  def('W', [0x11,0x11,0x11,0x15,0x15,0x1b,0x11]);
  def('X', [0x11,0x11,0x0a,0x04,0x0a,0x11,0x11]);
  def('Y', [0x11,0x11,0x0a,0x04,0x04,0x04,0x04]);
  def('Z', [0x1f,0x01,0x02,0x04,0x08,0x10,0x1f]);
  def('0', [0x0e,0x11,0x13,0x15,0x19,0x11,0x0e]);
  def('1', [0x04,0x0c,0x04,0x04,0x04,0x04,0x0e]);
  def('2', [0x0e,0x11,0x01,0x02,0x04,0x08,0x1f]);
  def('3', [0x1f,0x02,0x04,0x02,0x01,0x11,0x0e]);
  def('4', [0x02,0x06,0x0a,0x12,0x1f,0x02,0x02]);
  def('5', [0x1f,0x10,0x1e,0x01,0x01,0x11,0x0e]);
  def('6', [0x0e,0x10,0x1c,0x12,0x11,0x11,0x0e]);
  def('7', [0x1f,0x01,0x02,0x04,0x08,0x08,0x08]);
  def('8', [0x0e,0x11,0x11,0x0e,0x11,0x11,0x0e]);
  def('9', [0x0e,0x11,0x11,0x0f,0x01,0x11,0x0e]);
  def(':', [0x00,0x04,0x04,0x00,0x04,0x04,0x00]);
  def('-', [0x00,0x00,0x00,0x1f,0x00,0x00,0x00]);
  def('/', [0x01,0x02,0x02,0x04,0x08,0x08,0x10]);
  def('.', [0x00,0x00,0x00,0x00,0x00,0x04,0x04]);
  def('%', [0x11,0x13,0x05,0x02,0x0a,0x13,0x11]);
  def('(', [0x03,0x04,0x08,0x08,0x08,0x04,0x03]);
  def(')', [0x18,0x04,0x02,0x02,0x02,0x04,0x18]);
  def('?', [0x0e,0x11,0x01,0x02,0x04,0x00,0x04]);
  def('■', [0x1f,0x1f,0x1f,0x1f,0x1f]);
  def('#', [0x0a,0x1f,0x0a,0x1f,0x0a]);
  def('~', [0x00,0x00,0x0b,0x18,0x10,0x00,0x00]);
  return G;
}

/**
 * Render a horizontal row of coin faces (H/T) to a transparent-background
 * RGBA PNG Buffer (white coins with a grey rim).
 * @param {Array<'heads'|'tails'>} results
 */
function renderCoinResults(results) {
  const face = 128;
  const gap = 24;
  const w = Math.max(1, results.length) * face + (Math.max(0, results.length - 1)) * gap;
  const h = face;
  const r = makeRaster(w, h, true);

  for (let i = 0; i < results.length; i++) {
    const cx = i * (face + gap) + face / 2;
    const cy = face / 2;
    const label = results[i] === 'heads' ? 'H' : 'T';

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= face / 2) {
          const inner = dist <= face / 2 - 6;
          if (inner) {
            setPixel(r, x, y, 255, 255, 255);
          } else {
            setPixel(r, x, y, 200, 200, 200);
          }
        }
      }
    }

    const [cr, cg, cb] = [60, 60, 60];
    drawText(r, Math.round(cx - 3), Math.round(cy - 3.5), label, cr, cg, cb);
  }

  return rasterToPng(r);
}

module.exports = { renderTrendChart, renderCoinResults };

// Self-test
if (require.main === module) {
  const buf = renderTrendChart({
    title: 'TEST ROLE TREND',
    series: [
      { name: 'Alpha', color: 0x57F287, points: [3, 5, 4, 8, 10, 7, 12] },
      { name: 'Beta', color: 0x3498DB, points: [10, 9, 11, 7, 6, 8, 5] },
    ],
    width: 400, height: 240,
  });
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-'));
  fs.writeFileSync(path.join(outDir, 'test_chart.png'), buf);
  const sig = buf.subarray(0, 8).toString('hex');
  console.log('PNG signature:', sig, '| bytes:', buf.length, '| valid:', sig === '89504e470d0a1a0a');
}
