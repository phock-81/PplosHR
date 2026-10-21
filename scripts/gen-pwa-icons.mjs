// Generates solid-colour rounded PWA icons with a simple "P" glyph. No external deps.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };

function png(size, maskable) {
  const bg = [28, 28, 30], fg = [255, 255, 255], accent = [0, 113, 227];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const pad = maskable ? 0 : size * 0.1, radius = maskable ? 0 : size * 0.22;
  const inRounded = (x, y) => {
    if (x < pad || y < pad || x >= size - pad || y >= size - pad) return false;
    const l = pad + radius, r = size - pad - radius;
    const cx = x < l ? l : x > r ? r : x, cy = y < l ? l : y > r ? r : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  // glyph box (safe zone: central 60%)
  const g0 = size * 0.3, g1 = size * 0.7, stem = size * 0.09;
  const isP = (x, y) => {
    if (y < g0 || y > g1) return false;
    if (x >= g0 && x <= g0 + stem) return true;                              // stem
    const bowlBottom = g0 + (g1 - g0) * 0.58;
    if (y <= g0 + stem && x >= g0 && x <= g1 - stem) return true;             // top bar
    if (y >= bowlBottom - stem && y <= bowlBottom && x >= g0 && x <= g1 - stem) return true; // mid bar
    if (x >= g1 - stem * 2 && x <= g1 - stem && y <= bowlBottom) return true; // right side
    return false;
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      let px = [0, 0, 0, 0];
      if (maskable ? true : inRounded(x, y)) px = [...(isP(x, y) ? fg : bg), 255];
      if (px[3] && y > size * 0.74 && y < size * 0.74 + size * 0.04 && x > g0 && x < g1) px = [...accent, 255];
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = px[3];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, false));
writeFileSync('public/icons/icon-512.png', png(512, false));
writeFileSync('public/icons/icon-maskable-512.png', png(512, true));
writeFileSync('public/icons/apple-touch-icon.png', png(180, true));
console.log('PWA icons generated');
