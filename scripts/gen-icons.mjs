// Generates simple calendar-style extension icons (blue square, white header
// bar, white grid dots) as PNGs without any dependencies.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c;
    });
  }
  let crc = -1;
  for (const b of buf) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const off = y * (size * 4 + 1) + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BLUE = [15, 76, 129, 255];
const WHITE = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

function iconPixel(x, y, size) {
  const m = Math.max(1, Math.round(size * 0.06)); // margin
  if (x < m || y < m || x >= size - m || y >= size - m) return TRANSPARENT;
  // header bar
  if (y < m + size * 0.22) return BLUE;
  // grid dots: 3x3 white squares on blue
  const inner = size - 2 * m;
  const gx = (x - m) / inner;
  const gy = (y - (m + size * 0.24)) / (size - (m + size * 0.24) - m);
  const cell = 1 / 3;
  const inDot = (v) => {
    const p = (v % cell) / cell;
    return p > 0.22 && p < 0.78;
  };
  if (gy >= 0 && inDot(gx) && inDot(gy)) return WHITE;
  return BLUE;
}

mkdirSync(join(root, 'public/icons'), { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(join(root, `public/icons/icon${size}.png`), png(size, iconPixel));
}
console.log('icons written to public/icons/');
