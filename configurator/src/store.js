import { create } from 'zustand';
import { DEFAULT_FONT_ID } from './utils/fonts';

/**
 * Parti del kit. Il codice mappa le mesh del GLB su queste chiavi:
 * prima per nome (`body`, `sleeves`, `collar`, `cuffs`, `shorts`, `socks`),
 * poi — per modelli non segmentati per nome, come le scansioni — per
 * posizione verticale del bounding box (calzettoni in basso, pantaloncini
 * al centro, maglia in alto).
 */
export const PART_KEYS = ['body', 'sleeves', 'collar', 'cuffs', 'shorts', 'socks'];

export const PART_LABELS = {
  body: 'Corpo maglia',
  sleeves: 'Maniche',
  collar: 'Colletto',
  cuffs: 'Polsini',
  shorts: 'Pantaloncini',
  socks: 'Calzettoni',
};

/** Parti su cui ha senso applicare un pattern (superfici estese). */
export const PATTERN_PARTS = ['body', 'shorts', 'socks'];

export const PATTERN_TYPES = [
  { value: 'none', label: 'Tinta unita' },
  { value: 'stripes', label: 'Strisce verticali' },
  { value: 'hoops', label: 'Strisce orizzontali' },
  { value: 'checker', label: 'Scacchi' },
  { value: 'camo', label: 'Camouflage' },
];

export const DECAL_POSITIONS = [
  { value: 'chest-center', label: 'Petto — centro' },
  { value: 'chest-left', label: 'Petto — sinistra' },
  { value: 'chest-right', label: 'Petto — destra' },
  { value: 'sleeve-left', label: 'Manica sinistra' },
  { value: 'sleeve-right', label: 'Manica destra' },
  { value: 'shorts-right-low', label: 'Pantaloncino — basso destra' },
  { value: 'shorts-left-low', label: 'Pantaloncino — basso sinistra' },
  { value: 'sock-front', label: 'Calza — davanti (entrambe)' },
];

export const NAME_POSITIONS = [
  { value: 'back-shoulders', label: 'Retro — spalle (sopra numero)' },
  { value: 'back-below-number', label: 'Retro — sotto il numero' },
];

export const NUMBER_POSITIONS = [
  { value: 'back-center', label: 'Retro — centro' },
  { value: 'chest-left', label: 'Petto — sinistra' },
  { value: 'chest-right', label: 'Petto — destra' },
  { value: 'shorts-left-low', label: 'Pantaloncino — basso sinistra' },
  { value: 'shorts-right-low', label: 'Pantaloncino — basso destra' },
];

export const FINISHES = [
  { value: 'matte', label: 'Opaco', hint: 'Tessuto cotone, roughness alta' },
  { value: 'shiny', label: 'Lucido / Satinato', hint: 'Poliestere tecnico, riflessi morbidi' },
  { value: 'mesh', label: 'Mesh / Traforato', hint: 'Normal map a pori per tessuto sportivo' },
];

export const DECAL_SLOTS = [
  { key: 'main', label: 'Sponsor principale' },
  { key: 'team', label: 'Logo squadra' },
  { key: 'tech', label: 'Sponsor tecnico' },
];

const defaultPattern = (type = 'none') => ({
  type,
  color: '#ffffff',
  scale: 8,
  opacity: 1,
});

const defaultDecal = (position, scale) => ({
  src: null,
  position,
  scale,
  x: 0,
  y: 0,
  rotation: 0,
});

export const useKitStore = create((set) => ({
  parts: {
    body: { color: '#0d1b3d' },
    sleeves: { color: '#0d1b3d' },
    collar: { color: '#ffffff' },
    cuffs: { color: '#ffffff' },
    shorts: { color: '#ffffff' },
    socks: { color: '#0d1b3d' },
  },
  patterns: {
    body: defaultPattern('stripes'),
    shorts: defaultPattern(),
    socks: defaultPattern(),
  },
  finish: 'matte',
  decals: {
    main: defaultDecal('chest-center', 0.2),
    team: defaultDecal('chest-left', 0.12),
    tech: defaultDecal('chest-right', 0.12),
  },
  // Font, colore e contorno sono condivisi da nome e numero: nel catalogo
  // "Select your number" lo stile si sceglie una volta per tutto il kit.
  lettering: {
    fontId: DEFAULT_FONT_ID,
    color: '#ffffff',
    outlineColor: '#c8102e',
    outlineWidth: 0,
  },
  playerName: {
    text: '',
    position: 'back-shoulders',
    scale: 0.3,
  },
  playerNumber: {
    text: '',
    position: 'back-center',
    scale: 0.34,
  },

  setPartColor: (part, color) =>
    set((s) => ({ parts: { ...s.parts, [part]: { ...s.parts[part], color } } })),

  setPattern: (part, patch) =>
    set((s) => ({ patterns: { ...s.patterns, [part]: { ...s.patterns[part], ...patch } } })),

  setFinish: (finish) => set({ finish }),

  setDecal: (slot, patch) =>
    set((s) => ({ decals: { ...s.decals, [slot]: { ...s.decals[slot], ...patch } } })),

  clearDecal: (slot) =>
    set((s) => ({ decals: { ...s.decals, [slot]: { ...s.decals[slot], src: null } } })),

  setLettering: (patch) => set((s) => ({ lettering: { ...s.lettering, ...patch } })),

  setPlayerName: (patch) => set((s) => ({ playerName: { ...s.playerName, ...patch } })),

  setPlayerNumber: (patch) => set((s) => ({ playerNumber: { ...s.playerNumber, ...patch } })),
}));
