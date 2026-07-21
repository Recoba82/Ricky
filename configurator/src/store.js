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

/** Capo su cui applicare un elemento: determina la mesh bersaglio. */
export const PLACEMENT_PARTS = [
  { value: 'body', label: 'Maglia' },
  { value: 'shorts', label: 'Pantaloncini' },
  { value: 'socks', label: 'Calzettoni' },
];

/** Lato del capo verso cui proietta il decal. */
export const PLACEMENT_FACES = [
  { value: 'front', label: 'Davanti' },
  { value: 'back', label: 'Dietro' },
  { value: 'left', label: 'Lato sinistro' },
  { value: 'right', label: 'Lato destro' },
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

/**
 * Piazzamento libero: `part` sceglie il capo, `face` il lato, poi `x`/`y`
 * (-1..1) spostano l'elemento sulla superficie di quella parte. `mirror`
 * replica l'elemento su entrambi i gambali dei calzettoni.
 */
const placement = (over = {}) => ({
  part: 'body',
  face: 'front',
  x: 0,
  y: 0,
  rotation: 0,
  scale: 0.2,
  mirror: false,
  ...over,
});

const defaultDecal = (over) => ({ src: null, ...placement(over) });

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
    main: defaultDecal({ scale: 0.2, y: 0.05 }),
    team: defaultDecal({ scale: 0.12, x: -0.4, y: 0.45 }),
    tech: defaultDecal({ scale: 0.12, x: 0.4, y: 0.45 }),
  },
  // Font, colore e contorno sono condivisi da nome e numero: nel catalogo
  // "Select your number" lo stile si sceglie una volta per tutto il kit.
  lettering: {
    fontId: DEFAULT_FONT_ID,
    color: '#ffffff',
    outlineColor: '#c8102e',
    outlineWidth: 0,
  },
  // Default tarati sul retro maglia: nome alto sulle spalle, numero al
  // centro, senza sovrapporsi. Da qui l'utente sposta tutto liberamente.
  playerName: {
    text: '',
    ...placement({ face: 'back', y: 0.76, scale: 0.17 }),
  },
  playerNumber: {
    text: '',
    ...placement({ face: 'back', y: 0, scale: 0.23 }),
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
