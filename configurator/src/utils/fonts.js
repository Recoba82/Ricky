// Font sportivi bundlati localmente (nessuna richiesta di rete a runtime).
// Tutti con licenza SIL Open Font License, quindi ridistribuibili nel deploy.
// Bebas Neue e Montserrat compaiono anche nel catalogo "Select your number".
import '@fontsource/bebas-neue/400.css';
import '@fontsource/anton/400.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource/staatliches/400.css';
import '@fontsource/squada-one/400.css';
import '@fontsource/oswald/700.css';
import '@fontsource/teko/700.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/montserrat/800.css';

/**
 * `family`/`weight` compongono la stringa `font` del canvas 2D.
 * `hint` descrive lo stile del catalogo a cui si avvicina.
 *
 * Per aggiungere i font su licenza del catalogo TeamWear: metti il .woff2 in
 * `public/fonts/`, dichiara un @font-face in `src/index.css` e aggiungi qui
 * una voce con la stessa `family`. Nient'altro da toccare.
 */
export const NUMBER_FONTS = [
  { id: 'bebas', label: 'Bebas Neue', family: 'Bebas Neue', weight: 400, hint: 'Condensato classico' },
  { id: 'anton', label: 'Anton', family: 'Anton', weight: 400, hint: 'Condensato pesante' },
  { id: 'archivo', label: 'Archivo Black', family: 'Archivo Black', weight: 400, hint: 'Block grasso' },
  { id: 'staatliches', label: 'Staatliches', family: 'Staatliches', weight: 400, hint: 'Maiuscolo stretto' },
  { id: 'squada', label: 'Squada One', family: 'Squada One', weight: 400, hint: 'Block condensato' },
  { id: 'oswald', label: 'Oswald', family: 'Oswald', weight: 700, hint: 'Condensato moderno' },
  { id: 'teko', label: 'Teko', family: 'Teko', weight: 700, hint: 'Squadrato sportivo' },
  { id: 'rajdhani', label: 'Rajdhani', family: 'Rajdhani', weight: 700, hint: 'Tecnico squadrato' },
  { id: 'chakra', label: 'Chakra Petch', family: 'Chakra Petch', weight: 700, hint: 'Angolare racing' },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', weight: 800, hint: 'Geometrico' },
];

export const DEFAULT_FONT_ID = 'bebas';

export function getFont(id) {
  return NUMBER_FONTS.find((f) => f.id === id) ?? NUMBER_FONTS[0];
}

export function fontString(id, sizePx) {
  const f = getFont(id);
  return `${f.weight} ${sizePx}px "${f.family}", Arial, sans-serif`;
}

/**
 * I font web sono caricati in modo pigro dal browser: senza attendere qui, il
 * primo disegno su canvas userebbe il fallback e la texture resterebbe
 * sbagliata finché non cambia qualcos'altro.
 */
export async function ensureFontLoaded(id) {
  const f = getFont(id);
  try {
    await document.fonts.load(`${f.weight} 100px "${f.family}"`);
    await document.fonts.ready;
  } catch {
    // Font non disponibile: il canvas userà il fallback dichiarato.
  }
}
