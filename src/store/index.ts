import { create } from 'zustand';
import { type SoundSlot, defaultSlot, decodePreset, presetFilename } from '../codec/presetCodec';
import type { BitDepth } from '../audio/wavEncoder';

// ─── Sample library ───────────────────────────────────────────────────────────

export interface SampleEntry {
  id: string;
  /** Two-char SD card filename, e.g. "AA" */
  name: string;
  originalFilename: string;
  /** Mono Float32Array at 22050 Hz */
  audioData: Float32Array;
  bitDepth: BitDepth;
  /** Duration in seconds */
  duration: number;
}

// ─── Preset storage ───────────────────────────────────────────────────────────

function presetKey(bank: number, preset: number) {
  return presetFilename(bank, preset); // e.g. "P01.TXT"
}

function makeDefaultSlots(): SoundSlot[] {
  return Array.from({ length: 6 }, defaultSlot);
}

function dropImported(importedPresets: Set<string>, key: string): Set<string> {
  if (!importedPresets.has(key)) return importedPresets;
  const next = new Set(importedPresets);
  next.delete(key);
  return next;
}

// ─── Store shape ──────────────────────────────────────────────────────────────

export type Tab = 'samples' | 'presets' | 'export' | 'docs';

interface AppState {
  // Navigation
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;

  // Sample library
  samples: SampleEntry[];
  addSample: (entry: SampleEntry) => void;
  removeSample: (id: string) => void;
  updateSample: (id: string, patch: Partial<Pick<SampleEntry, 'name' | 'bitDepth'>>) => void;

  // Presets
  presets: Record<string, SoundSlot[]>;
  /** Keys of presets that were loaded directly from .TXT files. */
  importedPresets: Set<string>;
  activeBank: number;
  activePreset: number;
  setActivePreset: (bank: number, preset: number) => void;
  getPreset: (bank: number, preset: number) => SoundSlot[];
  setPreset: (bank: number, preset: number, slots: SoundSlot[]) => void;
  updateSlot: (bank: number, preset: number, slotIdx: number, patch: Partial<SoundSlot>) => void;
  loadPresetFile: (bank: number, preset: number, data: Uint8Array) => void;
  markPresetImported: (bank: number, preset: number) => void;
}

// ─── Auto-name generation ─────────────────────────────────────────────────────

// ─── Hash routing helpers ─────────────────────────────────────────────────────

const TABS_SET = new Set<Tab>(['samples', 'presets', 'export', 'docs']);

function tabFromHash(): Tab {
  const hash = window.location.hash.slice(1) as Tab;
  return TABS_SET.has(hash) ? hash : 'samples';
}

// ─── Auto-name generation ─────────────────────────────────────────────────────

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function nextAvailableName(usedNames: Set<string>): string {
  for (const c1 of CHARS) {
    for (const c2 of CHARS) {
      const name = c1 + c2;
      if (!usedNames.has(name)) return name;
    }
  }
  return 'AA'; // fallback (all 1296 names used)
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStore = create<AppState>((set, get) => ({
  activeTab: tabFromHash(),
  setActiveTab: (tab) => {
    window.location.hash = tab;
    set({ activeTab: tab });
  },

  samples: [],
  addSample: (entry) => set((s) => ({ samples: [...s.samples, entry] })),
  removeSample: (id) => set((s) => ({ samples: s.samples.filter((x) => x.id !== id) })),
  updateSample: (id, patch) =>
    set((s) => ({
      samples: s.samples.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),

  presets: {},
  importedPresets: new Set<string>(),
  activeBank: 0,
  activePreset: 0,

  setActivePreset: (bank, preset) => set({ activeBank: bank, activePreset: preset }),

  getPreset: (bank, preset) => {
    const key = presetKey(bank, preset);
    return get().presets[key] ?? makeDefaultSlots();
  },

  setPreset: (bank, preset, slots) => {
    const key = presetKey(bank, preset);
    set((s) => ({
      presets: { ...s.presets, [key]: slots },
      importedPresets: dropImported(s.importedPresets, key),
    }));
  },

  updateSlot: (bank, preset, slotIdx, patch) => {
    const key = presetKey(bank, preset);
    const slots = get().getPreset(bank, preset);
    const next = slots.map((slot, i) => (i === slotIdx ? { ...slot, ...patch } : slot));
    set((s) => ({
      presets: { ...s.presets, [key]: next },
      importedPresets: dropImported(s.importedPresets, key),
    }));
  },

  loadPresetFile: (bank, preset, data) => {
    const slots = decodePreset(data);
    const key = presetKey(bank, preset);
    set((s) => ({ presets: { ...s.presets, [key]: slots } }));
  },

  markPresetImported: (bank, preset) => {
    const key = presetKey(bank, preset);
    set((s) => {
      const next = new Set(s.importedPresets);
      next.add(key);
      return { importedPresets: next };
    });
  },
}));
