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

/* ---------- Analisi texture originale ---------- */

/**
 * Analizza la texture fotogrammetrica di una mesh e precalcola ciò che serve
 * al repaint: tonalità dominante del tessuto (per distinguere tessuto da
 * loghi stampati) e luminosità media del tessuto pulito (per cancellare i
 * loghi appiattendone la luminanza).
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
  for (let i = 0; i < data.length; i += 4) {
    const [h2, s] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    sumSin += Math.sin((h2 * Math.PI) / 180) * s;
    sumCos += Math.cos((h2 * Math.PI) / 180) * s;
    weightTotal += s;
  }
  const rawHue = weightTotal > 0 ? (Math.atan2(sumSin, sumCos) * 180) / Math.PI : 220;
  const referenceHue = ((rawHue % 360) + 360) % 360;

  let fabricLumSum = 0;
  let fabricWeightSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [h2, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const dist = hueDistance(h2, referenceHue);
    const satWeight = THREE.MathUtils.smoothstep(s, 0.06, 0.22);
    const hueWeight = 1 - THREE.MathUtils.smoothstep(dist, 25, 70);
    const fabricWeight = satWeight * hueWeight;
    fabricLumSum += l * fabricWeight;
    fabricWeightSum += fabricWeight;
  }
  const fabricLum = fabricWeightSum > 0.001 ? fabricLumSum / fabricWeightSum : 0.15;

  return { imageData, width: w, height: h, referenceHue, fabricLum };
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
 */
function patternTone(u, v, type, scale) {
  switch (type) {
    case 'stripes':
      return Math.floor(u * scale) % 2 === 0 ? 0 : 1;
    case 'hoops':
      return Math.floor(v * scale) % 2 === 0 ? 0 : 1;
    case 'checker':
      return (Math.floor(u * scale) + Math.floor(v * scale)) % 2;
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
 * branding originale: la tonalità viene sostituita ovunque, e la luminanza
 * dei pixel "non tessuto" (loghi) viene tirata verso la media del tessuto,
 * eliminandone la sagoma. La luminosità relativa di ogni pixel rispetto alla
 * media viene mantenuta come fattore di ombreggiatura (pieghe/AO) e
 * riapplicata sopra la luminosità del colore target.
 */
export function repaintTexture(analysis, { baseColor, pattern }) {
  const { imageData, width, height, referenceHue, fabricLum } = analysis;
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
      const [h, s, l] = rgbToHsl(src[i], src[i + 1], src[i + 2]);

      const dist = hueDistance(h, referenceHue);
      const satWeight = THREE.MathUtils.smoothstep(s, 0.06, 0.22);
      const hueWeight = 1 - THREE.MathUtils.smoothstep(dist, 25, 70);
      const brandWeight = 1 - satWeight * hueWeight;

      const blendedL = l * (1 - brandWeight) + fabricLum * brandWeight;
      const shade = THREE.MathUtils.clamp(blendedL / safeLum, 0.35, 2.2);

      const u = x / width;
      const v = y / height;
      const tone = opacity > 0 ? patternTone(u, v, pattern.type, pattern.scale) : 0;

      const baseL = THREE.MathUtils.clamp(baseHsl[2] * shade, 0.03, 0.95);
      let [nr, ng, nb] = hslToRgb(baseHsl[0], baseHsl[1], baseL);

      if (tone !== 0) {
        const toneHsl = tone === 2 ? patDarkHsl : patHsl;
        const toneL = THREE.MathUtils.clamp(toneHsl[2] * shade, 0.03, 0.95);
        const [pr, pg, pb] = hslToRgb(toneHsl[0], toneHsl[1], toneL);
        nr += (pr - nr) * opacity;
        ng += (pg - ng) * opacity;
        nb += (pb - nb) * opacity;
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

/* ---------- Normal map "mesh traforato" ---------- */

let meshNormalCache = null;

/**
 * Normal map procedurale a pori (generata una sola volta e condivisa) che
 * simula la trama traforata del tessuto sportivo. Altezze pseudocasuali ->
 * gradiente -> normale in tangent space.
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
