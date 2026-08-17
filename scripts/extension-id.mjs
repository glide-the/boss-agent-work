import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: node extension-id.mjs <manifest.json>');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (typeof manifest.key !== 'string' || manifest.key.length === 0) {
  throw new Error(`Manifest has no extension key: ${manifestPath}`);
}

const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
const extensionId = [...digest]
  .flatMap((byte) => [byte >> 4, byte & 0x0f])
  .map((nibble) => String.fromCharCode('a'.charCodeAt(0) + nibble))
  .join('');

process.stdout.write(`${extensionId}\n`);
