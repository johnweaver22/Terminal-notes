'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { inflateSync } = require('node:zlib');

const root = path.resolve(__dirname, '..');
const appURL = new URL('https://johnweaver22.github.io/Terminal-notes/');
const manifestURL = new URL('manifest.webmanifest', appURL);
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));

test('Terminal Notes has a distinct app identity and an in-scope standalone launch', () => {
  assert.equal(manifest.name, 'Terminal Notes');
  assert.equal(manifest.display, 'standalone');
  assert.notEqual(manifest.prefer_related_applications, true);
  const start = new URL(manifest.start_url, manifestURL);
  const scope = new URL(manifest.scope, manifestURL);
  assert.equal(start.href, appURL.href);
  assert.equal(scope.href, appURL.href);
  assert.equal(typeof manifest.id, 'string');
  assert.ok(manifest.id.length > 0, 'Keep the app identity explicit and stable');
  // The manifest spec resolves id against the START ORIGIN, not the manifest path.
  // Using "./" here accidentally gives every app on this GitHub Pages host one ID.
  const identity = new URL(manifest.id, start.origin + '/');
  identity.hash = '';
  assert.equal(identity.href, appURL.href, 'Terminal Notes must not share the origin-root app ID');
  assert.notEqual(identity.pathname, '/');
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readPNG(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'PNG signature');
  let offset = 8;
  let header;
  let ended = false;
  let idatEnded = false;
  const compressed = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'Truncated PNG chunk header or checksum');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    assert.ok(end <= bytes.length, `Truncated ${type} chunk: declares ${length} bytes`);
    assert.equal(crc32(bytes.subarray(offset + 4, end - 4)), bytes.readUInt32BE(end - 4), `${type} checksum`);
    const data = bytes.subarray(offset + 8, end - 4);
    if (!header) {
      assert.equal(type, 'IHDR', 'IHDR must be the first chunk');
      assert.equal(length, 13);
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9],
      };
      assert.equal(data[10], 0, 'Standard PNG compression');
      assert.equal(data[11], 0, 'Standard PNG filtering');
      assert.equal(data[12], 0, 'Install icons use non-interlaced PNGs');
    } else {
      assert.notEqual(type, 'IHDR', 'Only one IHDR is allowed');
    }
    if (type === 'IDAT') {
      assert.equal(idatEnded, false, 'IDAT chunks must be consecutive');
      compressed.push(data);
    } else if (compressed.length) {
      idatEnded = true;
    }
    offset = end;
    if (type === 'IEND') {
      assert.equal(length, 0, 'IEND must be empty');
      assert.equal(offset, bytes.length, 'No trailing or incomplete data after IEND');
      ended = true;
      break;
    }
  }
  assert.ok(header, 'Missing IHDR');
  assert.ok(ended, 'Missing IEND');
  assert.ok(compressed.length, 'Missing image data');
  assert.ok(header.width > 0 && header.height > 0, 'Positive image dimensions');
  const allowedDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  assert.ok(allowedDepths[header.colorType]?.includes(header.bitDepth), 'Valid PNG color type and bit depth');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const rowBytes = Math.ceil(header.width * channels * header.bitDepth / 8);
  const expectedLength = (rowBytes + 1) * header.height;
  const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedLength + 1 });
  assert.equal(decoded.length, expectedLength, 'Every declared PNG scanline must decode completely');
  for (let row = 0; row < header.height; row++) {
    assert.ok(decoded[row * (rowBytes + 1)] <= 4, `Valid filter for PNG row ${row}`);
  }
  return header;
}

test('Manifest offers both required ordinary install icon sizes', () => {
  assert.ok(Array.isArray(manifest.icons));
  for (const size of [192, 512]) {
    assert.ok(manifest.icons.some(icon =>
      icon.type === 'image/png' &&
      (icon.purpose || 'any').split(/\s+/).includes('any') &&
      (icon.sizes || '').split(/\s+/).includes(`${size}x${size}`)
    ), `Missing ${size}px PNG icon usable for ordinary installation`);
  }
});

for (const icon of manifest.icons || []) {
  test(`Install icon ${icon.src} has complete PNG data and truthful dimensions`, () => {
    assert.equal(icon.type, 'image/png');
    const url = new URL(icon.src, manifestURL);
    assert.equal(url.origin, appURL.origin);
    assert.ok(url.pathname.startsWith(appURL.pathname), 'Install icon stays inside the app');
    // URL parsing drops cache-busting query strings before reading the local asset.
    const relative = decodeURIComponent(url.pathname.slice(appURL.pathname.length));
    const filename = path.resolve(root, relative);
    assert.ok(filename.startsWith(root + path.sep), 'Install icon stays inside the repository');
    const png = readPNG(readFileSync(filename));
    assert.equal(png.width, png.height, 'Install icons are square');
    assert.equal(icon.sizes, `${png.width}x${png.height}`, 'Manifest size must match actual pixels');
  });
}
