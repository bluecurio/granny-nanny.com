/**
 * Bit-packing codec matching the microGranny 2.0 firmware (MEM.ino).
 *
 * Variables are packed into a 12-byte slot using per-variable byte/bit
 * coordinates. A variable may span up to 3 bytes.
 *
 * Source: github.com/bastl-instruments/microGranny2
 */

export const NUMBER_OF_VARIABLES = 11;
export const NUMBER_OF_BYTES = 12;
export const NUMBER_OF_SOUNDS = 6;

/** Bit-width of each variable (index = variable index). */
export const VARIABLE_DEPTH: readonly number[] = [10, 7, 7, 7, 7, 8, 10, 10, 8, 7, 7];

/** Starting byte offset within the 12-byte slot. */
export const BYTE_COORDINATE: readonly number[] = [0, 1, 2, 3, 3, 4, 5, 7, 8, 9, 10];

/** Starting bit within the starting byte. */
export const BIT_COORDINATE: readonly number[] = [0, 2, 1, 0, 7, 6, 6, 0, 2, 2, 1];

/** Maximum value for each variable. */
export const MAX_VALUE: readonly number[] = [1023, 127, 127, 127, 127, 255, 1023, 1023, 63, 127, 127];

/** Default "clear" value for each variable (from firmware clearTo[]). */
export const CLEAR_TO: readonly number[] = [877, 0, 0, 0, 0, 128, 0, 1022, 13, 65, 48];

/**
 * Read one variable from a 12-byte slot buffer.
 * Mirrors firmware getVar().
 */
export function getVar(slotBytes: Uint8Array, varIndex: number): number {
  const depth = VARIABLE_DEPTH[varIndex];
  const startByte = BYTE_COORDINATE[varIndex];
  const startBit = BIT_COORDINATE[varIndex];

  let value = 0;

  for (let i = 0; i < depth; i++) {
    let byteShift: number;
    let bitCoord: number;

    if (startBit + i > 15) {
      byteShift = 2;
      bitCoord = i - (16 - startBit);
    } else if (startBit + i > 7) {
      byteShift = 1;
      bitCoord = i - (8 - startBit);
    } else {
      byteShift = 0;
      bitCoord = startBit + i;
    }

    const bit = (slotBytes[startByte + byteShift] >> bitCoord) & 1;
    value |= bit << i;
  }

  return value;
}

/**
 * Write one variable into a 12-byte slot buffer (mutates in place).
 * Mirrors firmware setVar().
 */
export function setVar(slotBytes: Uint8Array, varIndex: number, value: number): void {
  const depth = VARIABLE_DEPTH[varIndex];
  const startByte = BYTE_COORDINATE[varIndex];
  const startBit = BIT_COORDINATE[varIndex];

  const clamped = Math.max(0, Math.min(MAX_VALUE[varIndex], value));

  for (let i = 0; i < depth; i++) {
    let byteShift: number;
    let bitCoord: number;

    if (startBit + i > 15) {
      byteShift = 2;
      bitCoord = i - (16 - startBit);
    } else if (startBit + i > 7) {
      byteShift = 1;
      bitCoord = i - (8 - startBit);
    } else {
      byteShift = 0;
      bitCoord = startBit + i;
    }

    const byteIdx = startByte + byteShift;
    const bit = (clamped >> i) & 1;
    if (bit) {
      slotBytes[byteIdx] |= 1 << bitCoord;
    } else {
      slotBytes[byteIdx] &= ~(1 << bitCoord);
    }
  }
}
