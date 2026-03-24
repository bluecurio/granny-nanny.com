/**
 * Quick roundtrip verification against the example preset files.
 * Run with: npx tsx src/codec/verify.ts
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { decodePreset, encodePreset, presetFilename, parsePresetFilename } from './presetCodec';

const examplesDir = join(import.meta.dirname, '../../examples');
const files = readdirSync(examplesDir).filter(f => /\.TXT$/i.test(f)).sort();

let passed = 0;
let failed = 0;

for (const file of files) {
  const raw = new Uint8Array(readFileSync(join(examplesDir, file)));
  const parsed = parsePresetFilename(file);
  if (!parsed) { console.warn(`SKIP: ${file} (unrecognised name)`); continue; }

  // Decode
  let slots;
  try {
    slots = decodePreset(raw);
  } catch (e) {
    console.error(`FAIL decode ${file}: ${e}`);
    failed++;
    continue;
  }

  // Re-encode and compare byte-for-byte
  const reencoded = encodePreset(slots);
  let match = reencoded.length === raw.length;
  if (match) {
    for (let i = 0; i < raw.length; i++) {
      if (reencoded[i] !== raw[i]) { match = false; break; }
    }
  }

  if (!match) {
    console.error(`FAIL roundtrip ${file}`);
    for (let i = 0; i < raw.length; i++) {
      if (reencoded[i] !== raw[i]) {
        console.error(`  byte[${i}]: original=0x${raw[i].toString(16).padStart(2,'0')} re-encoded=0x${reencoded[i].toString(16).padStart(2,'0')}`);
      }
    }
    failed++;
    continue;
  }

  // Print decoded values for spot-checking
  const name = presetFilename(parsed.bank, parsed.preset);
  console.log(`\nOK  ${file} (→ ${name})`);
  slots.forEach((s, i) => {
    const flags = [
      s.setting & 1  ? 'TUNED'  : '',
      s.setting & 2  ? 'LEGATO' : '',
      s.setting & 4  ? 'REPEAT' : '',
      s.setting & 8  ? 'SYNC'   : '',
      s.setting & 16 ? 'RAND'   : '',
    ].filter(Boolean).join('|') || 'none';
    console.log(
      `  slot${i+1}: sample=${s.sampleName}  rate=${s.rate}  crush=${s.crush}  ` +
      `atk=${s.attack}  rel=${s.release}  loopLen=${s.loopLength}  shift=${s.shiftSpeed}  ` +
      `start=${s.start}  end=${s.end}  flags=${flags}`
    );
  });
  passed++;
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
