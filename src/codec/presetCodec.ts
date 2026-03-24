import {
  CLEAR_TO,
  NUMBER_OF_BYTES,
  NUMBER_OF_SOUNDS,
  getVar,
  setVar,
} from './bitPack';

// ─── Variable indices (matching firmware defines) ─────────────────────────────

export const VAR = {
  RATE: 0,
  CRUSH: 1,
  ATTACK: 2,
  RELEASE: 3,
  LOOP_LENGTH: 4,
  SHIFT_SPEED: 5,
  START: 6,
  END: 7,
  SETTING: 8,
  SAMPLE_NAME_1: 9,
  SAMPLE_NAME_2: 10,
} as const;

// ─── SETTING flag bits ────────────────────────────────────────────────────────

export const SETTING_FLAG = {
  TUNED: 1 << 0,
  LEGATO: 1 << 1,
  REPEAT: 1 << 2,
  SYNC: 1 << 3,
  RAND_SHIFT: 1 << 4,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SoundSlot {
  /** Playback rate, 0–1023. 877 = original pitch. */
  rate: number;
  /** Bit-crusher depth, 0–127. */
  crush: number;
  /** Attack time, 0–127. */
  attack: number;
  /** Release time, 0–127. */
  release: number;
  /** Grain loop length, 0–127. */
  loopLength: number;
  /** Grain shift speed, 0–255. 128 = no shift. */
  shiftSpeed: number;
  /** Playback start position, 0–1023. */
  start: number;
  /** Playback end position, 0–1023. */
  end: number;
  /** SETTING flags byte (use SETTING_FLAG bitmask). Max 63. */
  setting: number;
  /** Two-character sample filename, e.g. "AA", "B3". */
  sampleName: string;
}

export interface Preset {
  /** Bank index 0–9. */
  bank: number;
  /** Preset index 0–5 (shown as 1–6 in filenames). */
  preset: number;
  slots: [SoundSlot, SoundSlot, SoundSlot, SoundSlot, SoundSlot, SoundSlot];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function defaultSlot(): SoundSlot {
  return {
    rate: CLEAR_TO[VAR.RATE],
    crush: CLEAR_TO[VAR.CRUSH],
    attack: CLEAR_TO[VAR.ATTACK],
    release: CLEAR_TO[VAR.RELEASE],
    loopLength: CLEAR_TO[VAR.LOOP_LENGTH],
    shiftSpeed: CLEAR_TO[VAR.SHIFT_SPEED],
    start: CLEAR_TO[VAR.START],
    end: CLEAR_TO[VAR.END],
    setting: CLEAR_TO[VAR.SETTING],
    sampleName: String.fromCharCode(CLEAR_TO[VAR.SAMPLE_NAME_1], CLEAR_TO[VAR.SAMPLE_NAME_2]),
  };
}

export function defaultPreset(bank = 0, preset = 0): Preset {
  return {
    bank,
    preset,
    slots: Array.from({ length: NUMBER_OF_SOUNDS }, defaultSlot) as Preset['slots'],
  };
}

/**
 * Returns the SD-card filename for a preset, e.g. "P01.TXT".
 * bank: 0–9, preset: 0–5 (internally), filename uses 1–6.
 */
export function presetFilename(bank: number, preset: number): string {
  return `P${bank}${preset + 1}.TXT`;
}

/**
 * Parses a preset filename like "P01.TXT" → { bank: 0, preset: 0 }.
 * Returns null if the filename doesn't match the expected format.
 */
export function parsePresetFilename(filename: string): { bank: number; preset: number } | null {
  const m = /^[Pp](\d)([1-6])\.txt$/i.exec(filename);
  if (!m) return null;
  return { bank: parseInt(m[1], 10), preset: parseInt(m[2], 10) - 1 };
}

// ─── Encoder / Decoder ───────────────────────────────────────────────────────

/**
 * Decode a 72-byte preset binary buffer into 6 SoundSlots.
 */
export function decodePreset(data: Uint8Array): SoundSlot[] {
  if (data.length !== NUMBER_OF_SOUNDS * NUMBER_OF_BYTES) {
    throw new Error(`Expected ${NUMBER_OF_SOUNDS * NUMBER_OF_BYTES} bytes, got ${data.length}`);
  }

  return Array.from({ length: NUMBER_OF_SOUNDS }, (_, s) => {
    const slotBytes = data.subarray(s * NUMBER_OF_BYTES, (s + 1) * NUMBER_OF_BYTES);
    return {
      rate: getVar(slotBytes, VAR.RATE),
      crush: getVar(slotBytes, VAR.CRUSH),
      attack: getVar(slotBytes, VAR.ATTACK),
      release: getVar(slotBytes, VAR.RELEASE),
      loopLength: getVar(slotBytes, VAR.LOOP_LENGTH),
      shiftSpeed: getVar(slotBytes, VAR.SHIFT_SPEED),
      start: getVar(slotBytes, VAR.START),
      end: getVar(slotBytes, VAR.END),
      setting: getVar(slotBytes, VAR.SETTING),
      sampleName: String.fromCharCode(
        getVar(slotBytes, VAR.SAMPLE_NAME_1),
        getVar(slotBytes, VAR.SAMPLE_NAME_2),
      ),
    };
  });
}

/**
 * Encode 6 SoundSlots into a 72-byte preset binary buffer.
 */
export function encodePreset(slots: SoundSlot[]): Uint8Array {
  const data = new Uint8Array(NUMBER_OF_SOUNDS * NUMBER_OF_BYTES);

  for (let s = 0; s < NUMBER_OF_SOUNDS; s++) {
    const slot = slots[s] ?? defaultSlot();
    const slotBytes = new Uint8Array(NUMBER_OF_BYTES);

    setVar(slotBytes, VAR.RATE, slot.rate);
    setVar(slotBytes, VAR.CRUSH, slot.crush);
    setVar(slotBytes, VAR.ATTACK, slot.attack);
    setVar(slotBytes, VAR.RELEASE, slot.release);
    setVar(slotBytes, VAR.LOOP_LENGTH, slot.loopLength);
    setVar(slotBytes, VAR.SHIFT_SPEED, slot.shiftSpeed);
    setVar(slotBytes, VAR.START, slot.start);
    setVar(slotBytes, VAR.END, slot.end);
    setVar(slotBytes, VAR.SETTING, slot.setting);
    setVar(slotBytes, VAR.SAMPLE_NAME_1, slot.sampleName.charCodeAt(0));
    setVar(slotBytes, VAR.SAMPLE_NAME_2, slot.sampleName.charCodeAt(1));

    data.set(slotBytes, s * NUMBER_OF_BYTES);
  }

  return data;
}

/**
 * Helper: get individual SETTING flags as booleans.
 */
export function getSettingFlags(setting: number) {
  return {
    tuned: !!(setting & SETTING_FLAG.TUNED),
    legato: !!(setting & SETTING_FLAG.LEGATO),
    repeat: !!(setting & SETTING_FLAG.REPEAT),
    sync: !!(setting & SETTING_FLAG.SYNC),
    randShift: !!(setting & SETTING_FLAG.RAND_SHIFT),
  };
}

/**
 * Helper: build a SETTING byte from individual flags.
 */
export function buildSetting(flags: {
  tuned?: boolean;
  legato?: boolean;
  repeat?: boolean;
  sync?: boolean;
  randShift?: boolean;
}): number {
  let s = 0;
  if (flags.tuned) s |= SETTING_FLAG.TUNED;
  if (flags.legato) s |= SETTING_FLAG.LEGATO;
  if (flags.repeat) s |= SETTING_FLAG.REPEAT;
  if (flags.sync) s |= SETTING_FLAG.SYNC;
  if (flags.randShift) s |= SETTING_FLAG.RAND_SHIFT;
  return s;
}
