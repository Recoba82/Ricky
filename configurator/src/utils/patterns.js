import * as THREE from 'three';

const WORK_SIZE = 1024;

/* ---------- Conversioni colore ---------- */

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function hexToHsl(hex) {
  const v = parseInt(hex.slice(1), 16);
  return rgbToHsl((v >> 16) & 255, (v >> 8) & 255, v & 255);
}

/* ---------- Sfocatura (box blur separabile) ---------- */

function clampInt(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Box blur separabile su una mappa scalare (usata sulla luminosità).
 */
function boxBlur(src, w, h, radius) {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const size = radius * 2 + 1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += src[row + clampInt(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / size;
      const addX = clampInt(x + radius + 1, 0, w - 1);
      const subX = clampInt(x - radius, 0, w - 1);
      acc += src[row + addX] - src[row + subX];
    }
  }

  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[clampInt(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / size;
      const addY = clampInt(y + radius + 1, 0, h - 1);
      const subY = clampInt(y - radius, 0, h - 1);
      acc += tmp[addY * w + x] - tmp[subY * w + x];
    }
  }

  return out;
}

/**
 * Sfocatura forte in tre passate (approssima una gaussiana ad ampio raggio):
 * appiattisce del tutto dettagli piccoli e ad alto contrasto - stemmi,
 * scritte, contorni stampati, anche quelli con contrasto marcato - mentre le
 * variazioni ampie e graduali dovute a pieghe/ombreggiatura del tessuto
 * scansionato, che si estendono su porzioni molto più grandi della texture,
 * restano sostanzialmente intatte.
 */
function strongBlur(src, w, h, radius) {
  let out = src;
  for (let pass = 0; pass < 3; pass++) {
    out = boxBlur(out, w, h, radius);
  }
  return out;
}

/* ---------- Analisi texture originale ---------- */

/**
 * Analizza la texture fotogrammetrica di una mesh e precalcola ciò che serve
 * al repaint: tonalità dominante del tessuto (per pesare la luminosità media)
 * e una mappa di luminosità fortemente sfocata su tutta la texture, usata per
 * cancellare loghi e scritte stampate mantenendone solo l'ombreggiatura di
 * piega.
 */
export function analyzeTexture(image) {
  const canvas = document.createElement('canvas');
  const w = Math.min(WORK_SIZE, image.width || WORK_SIZE);
  const h = Math.min(WORK_SIZE, image.height || WORK_SIZE);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  let sumSin = 0;
  let sumCos = 0;
  let weightTotal = 0;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const [h2, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    sumSin += Math.sin((h2 * Math.PI) / 180) * s;
    sumCos += Math.cos((h2 * Math.PI) / 180) * s;
    weightTotal += s;
    lum[p] = l;
  }
  const rawHue = weightTotal > 0 ? (Math.atan2(sumSin, sumCos) * 180) / Math.PI : 220;
  const referenceHue = ((rawHue % 360) + 360) % 360;

  // Raggio ampio e tre passate: sufficiente a coprire stemmi, loghi e scritte
  // stampate di varie dimensioni, restando comunque più piccolo delle pieghe
  // ampie del capo.
        const blurRadius = Math.max(2, Math.round(Math.max(w, h) * 0.35));
  const blurredLum = strongBlur(lum, w, h, blurRadius);

  let fabricLumSum = 0;
  let fabricWeightSum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const [h2, s] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const dist = hueDistance(h2, referenceHue);
    const satWeight = THREE.MathUtils.smoothstep(s, 0.06, 0.22);
    const hueWeight = 1 - THREE.MathUtils.smoothstep(dist, 25, 70);
    const fabricWeight = satWeight * hueWeight;
    fabricLumSum += blurredLum[p] * fabricWeight;
    fabricWeightSum += fabricWeight;
  }
  const fabricLum = fabricWeightSum > 0.001 ? fabricLumSum / fabricWeightSum : 0.15;

  return { imageData, width: w, height: h, referenceHue, fabricLum, blurredLum };
}

/* ---------- Generatori di pattern in spazio UV ---------- */

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(u, v) {
  const x = Math.floor(u);
  const y = Math.floor(v);
  const fx = u - x;
  const fy = v - y;
  const a = hash2(x, y);
  const b = hash2(x + 1, y);
  const c = hash2(x, y + 1);
  const d = hash2(x + 1, y + 1);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Ritorna il "tono" del pattern per un punto UV:
 * 0 = colore base, 1 = colore pattern, 2 = colore pattern scurito (camo).
 * I valori frazionari tra 0 e 1 indicano una miscela parziale del colore
 * pattern: servono ai pattern sfumati (gradiente, halftone).
 */
function patternTone(u, v, type, scale) {
  switch (type) {
    case 'stripes':
      return Math.floor(u * scale) % 2 === 0 ? 0 : 1;
    case 'hoops':
      return Math.floor(v * scale) % 2 === 0 ? 0 : 1;
    case 'checker':
      return (Math.floor(u * scale) + Math.floor(v * scale)) % 2;
    case 'pinstripe': {
      const f = (u * scale * 1.6) % 1;
      return f < 0.16 ? 1 : 0;
    }
    case 'diagonal':
      return Math.floor((u + v) * scale) % 2 === 0 ? 0 : 1;
    case 'chevron': {
      const zig = Math.abs(((u * scale) % 2) - 1);
      return Math.floor(v * scale + zig) % 2 === 0 ? 0 : 1;
    }
    case 'sash': {
      const d = (u + (1 - v)) / 2;
      return d > 0.44 && d < 0.6 ? 1 : 0;
    }
    case 'grid': {
      const fu = (u * scale) % 1;
      const fv = (v * scale) % 1;
      return fu < 0.08 || fv < 0.08 ? 1 : 0;
    }
    case 'dots': {
      const cx = ((u * scale) % 1) - 0.5;
      const cy = ((v * scale) % 1) - 0.5;
      return Math.sqrt(cx * cx + cy * cy) < 0.26 ? 1 : 0;
    }
    case 'halftone': {
      const cx = ((u * scale) % 1) - 0.5;
      const cy = ((v * scale) % 1) - 0.5;
      const radius = 0.06 + 0.4 * (1 - v);
      return Math.sqrt(cx * cx + cy * cy) < radius ? 1 : 0;
    }
    case 'hex': {
      const row = v * scale;
      const odd = Math.floor(row) % 2 !== 0;
      const cx = ((u * scale + (odd ? 0.5 : 0)) % 1) - 0.5;
      const cy = (row % 1) - 0.5;
      const d = Math.max(Math.abs(cy), Math.abs(cx) * 0.866 + Math.abs(cy) * 0.5);
      return d > 0.36 ? 1 : 0;
    }
    case 'gradient':
      return THREE.MathUtils.clamp(1 - v, 0, 1);
    case 'camo': {
      const n =
        0.65 * valueNoise(u * scale, v * scale) +
        0.35 * valueNoise(u * scale * 2.3 + 7.31, v * scale * 2.3 + 3.7);
      if (n < 0.45) return 0;
      if (n < 0.62) return 1;
      return 2;
    }
    default:
      return 0;
  }
}

/* ---------- Repaint della texture ---------- */

/**
 * Ridipinge la texture analizzata con colore base + pattern, cancellando il
 * branding originale: la tonalità viene sostituita ovunque e l'ombreggiatura
 * usata per ogni pixel viene presa dalla mappa di luminosità sfocata (non dal
 * pixel originale), così stemmi, loghi e scritte stampate - anche quando
 * condividono la tonalità del tessuto o hanno un contrasto marcato -
 * spariscono insieme al resto del dettaglio ad alta frequenza. Restano solo
 * le variazioni ampie di piega/ombreggiatura, riapplicate sopra la
 * luminosità del colore target.
 */
export function repaintTexture(analysis, { baseColor, pattern }) {
  const { imageData, width, height, fabricLum, blurredLum } = analysis;
  const baseHsl = hexToHsl(baseColor);
  const patHsl = hexToHsl(pattern.color);
  const patDarkHsl = [patHsl[0], patHsl[1], Math.max(0.05, patHsl[2] * 0.55)];
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);
  const safeLum = Math.max(fabricLum, 0.02);
  const opacity = pattern.type === 'none' ? 0 : pattern.opacity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const p = y * width + x;

      const shade = THREE.MathUtils.clamp(blurredLum[p] / safeLum, 0.35, 2.2);

      const u = x / width;
      const v = y / height;
      const tone = opacity > 0 ? patternTone(u, v, pattern.type, pattern.scale) : 0;

      const baseL = THREE.MathUtils.clamp(baseHsl[2] * shade, 0.03, 0.95);
      let [nr, ng, nb] = hslToRgb(baseHsl[0], baseHsl[1], baseL);

      if (tone !== 0) {
        const toneHsl = tone === 2 ? patDarkHsl : patHsl;
        const mix = tone === 2 ? 1 : Math.min(tone, 1);
        const toneL = THREE.MathUtils.clamp(toneHsl[2] * shade, 0.03, 0.95);
        const [pr, pg, pb] = hslToRgb(toneHsl[0], toneHsl[1], toneL);
        nr += (pr - nr) * opacity * mix;
        ng += (pg - ng) * opacity * mix;
        nb += (pb - nb) * opacity * mix;
      }

      out[i] = nr;
      out[i + 1] = ng;
      out[i + 2] = nb;
      out[i + 3] = src[i + 3];
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(out, width, height), 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* ---------- Sampler ---------- */

export function extractSampler(map) {
  return {
    wrapS: map.wrapS,
    wrapT: map.wrapT,
    repeat: map.repeat.clone(),
    offset: map.offset.clone(),
    center: map.center.clone(),
    rotation: map.rotation,
    flipY: map.flipY,
    colorSpace: map.colorSpace,
    anisotropy: map.anisotropy,
  };
}

export function applySampler(texture, sampler) {
  texture.wrapS = sampler.wrapS;
  texture.wrapT = sampler.wrapT;
  texture.repeat.copy(sampler.repeat);
  texture.offset.copy(sampler.offset);
  texture.center.copy(sampler.center);
  texture.rotation = sampler.rotation;
  texture.flipY = sampler.flipY;
  texture.colorSpace = sampler.colorSpace;
  texture.anisotropy = sampler.anisotropy;
  texture.needsUpdate = true;
}

/* ---------- Normal map "trama tessuto" ---------- */

let meshNormalCache = null;

/**
 * Normal map procedurale a pori (generata una sola volta e condivisa) che
 * simula la trama traforata del tessuto sportivo. Altezze pseudocasuali ->
 * gradiente -> normale in tangent space. Usata di default su ogni finitura
 * per dare rilievo micro-superficiale realistico, non solo sulla finitura
 * "Mesh tecnico".
 */
export function getMeshNormalTexture() {
  if (meshNormalCache) return meshNormalCache;

  const size = 256;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n =
        0.6 * valueNoise(x * 0.35, y * 0.35) +
        0.4 * valueNoise(x * 0.9 + 13.7, y * 0.9 + 41.3);
      const pore = n > 0.62 ? 1 : 0;
      heights[y * size + x] = pore;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x - 1, y) - at(x + 1, y);
      const dy = at(x, y - 1) - at(x, y + 1);
      const nrm = new THREE.Vector3(dx, dy, 1).normalize();
      const i = (y * size + x) * 4;
      img.data[i] = (nrm.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (nrm.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nrm.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 10);
  meshNormalCache = texture;
  return texture;
}

let ribNormalCache = null;

/**
 * Normal map "a costine" (rib-knit) per il colletto Polo: creste verticali
 * regolari, generate come un'onda quasi triangolare lungo l'asse U del
 * tile e costanti lungo la V. E' diversa dalla trama a pori del tessuto
 * piatto (getMeshNormalTexture) e replica invece il rilievo del maglione a
 * coste tipico del collo/falde polo. Chi la usa clona la texture per
 * impostare un `repeat` proprio (piu' fitto sulla fascia, piu' rado sulle
 * falde) mantenendo lo stesso pattern di base.
 */
export function getRibNormalTexture() {
  if (ribNormalCache) return ribNormalCache;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  const ridgesPerTile = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * ridgesPerTile * Math.PI * 2;
      const slope = Math.sin(u);
      // Esponente <1 sul modulo appiattisce il fondo e accentua il bordo
      // della costa, dando un profilo piu' vicino a una maglia reale che a
      // una semplice sinusoide.
      const shaped = Math.sign(slope) * Math.pow(Math.abs(slope), 0.6);
      const nrm = new THREE.Vector3(shaped * 0.9, 0, 1).normalize();
      const i = (y * size + x) * 4;
      img.data[i] = (nrm.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (nrm.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nrm.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  ribNormalCache = texture;
  return texture;
}
