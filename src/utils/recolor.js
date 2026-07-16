import * as THREE from 'three';

const WORK_SIZE = 1024;

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

/**
 * Downscales an image onto an offscreen canvas and precomputes everything a
 * later recolor/repaint pass needs: the fabric's dominant hue (so we know
 * which pixels are "fabric" vs. a printed logo) and a heavily blurred
 * luminance grid (so logo shapes can be smoothed away instead of just
 * recolored).
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

  // Pass 1: dominant fabric hue (saturation-weighted circular mean).
  let sumSin = 0;
  let sumCos = 0;
  let weightTotal = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [h2, s] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    sumSin += Math.sin((h2 * Math.PI) / 180) * s;
    sumCos += Math.cos((h2 * Math.PI) / 180) * s;
    weightTotal += s;
  }
  const referenceHue = weightTotal > 0 ? (Math.atan2(sumSin, sumCos) * 180) / Math.PI : 220;
  const normalizedHue = ((referenceHue % 360) + 360) % 360;

  // Pass 2: a single fabric-weighted average lightness for the whole
  // texture. Logo/branding pixels get near-zero weight so they can't bias
  // it — used later to flatten out exactly those pixels, erasing the
  // printed shape rather than just recoloring it.
  let fabricLumSum = 0;
  let fabricWeightSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [h2, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const dist = hueDistance(h2, normalizedHue);
    const satWeight = THREE.MathUtils.smoothstep(s, 0.06, 0.22);
    const hueWeight = 1 - THREE.MathUtils.smoothstep(dist, 25, 70);
    const fabricWeight = satWeight * hueWeight;
    fabricLumSum += l * fabricWeight;
    fabricWeightSum += fabricWeight;
  }
  const fabricLum = fabricWeightSum > 0.001 ? fabricLumSum / fabricWeightSum : 0.15;

  return {
    imageData,
    width: w,
    height: h,
    referenceHue: normalizedHue,
    fabricLum,
  };
}

function patternColorAt(u, v, { pattern, primaryHsl, secondaryHsl, bands }) {
  switch (pattern) {
    case 'stripes':
      return Math.floor(u * bands) % 2 === 0 ? primaryHsl : secondaryHsl;
    case 'hoops':
      return Math.floor(v * bands) % 2 === 0 ? primaryHsl : secondaryHsl;
    case 'sash': {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = dx * Math.cos(Math.PI / 4) - dy * Math.sin(Math.PI / 4);
      return d > -0.14 && d < 0.14 ? secondaryHsl : primaryHsl;
    }
    default:
      return primaryHsl;
  }
}

/**
 * Repaints an analyzed texture with a fully custom pattern/color scheme,
 * discarding the original hue *and* absolute brightness everywhere (so
 * baked-in logos lose their color and — since their lightness gets pulled
 * toward the texture's average fabric brightness — their printed shape
 * too). Each pixel's lightness relative to the fabric average is kept as a
 * shading multiplier so folds/AO still read, but it's applied on top of the
 * target color's own lightness instead of the original absolute value —
 * otherwise a bright target like white would inherit the source navy
 * fabric's dark lightness and come out as muddy gray.
 */
export function applyKitTexture(analysis, { pattern = 'solid', primary, secondary, bands = 8 }) {
  const { imageData, width, height, referenceHue, fabricLum } = analysis;
  const primaryHsl = hexToHsl(primary);
  const secondaryHsl = hexToHsl(secondary || primary);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);
  const safeFabricLum = Math.max(fabricLum, 0.02);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [h, s, l] = rgbToHsl(src[i], src[i + 1], src[i + 2]);

      const dist = hueDistance(h, referenceHue);
      const satWeight = THREE.MathUtils.smoothstep(s, 0.06, 0.22);
      const hueWeight = 1 - THREE.MathUtils.smoothstep(dist, 25, 70);
      const fabricWeight = satWeight * hueWeight;
      const brandWeight = 1 - fabricWeight;

      const blendedL = l * (1 - brandWeight) + fabricLum * brandWeight;
      const shadeFactor = THREE.MathUtils.clamp(blendedL / safeFabricLum, 0.35, 2.2);

      const u = x / width;
      const v = y / height;
      const [ph, ps, pl] = patternColorAt(u, v, { pattern, primaryHsl, secondaryHsl, bands });
      const targetL = THREE.MathUtils.clamp(pl * shadeFactor, 0.03, 0.95);

      const [nr, ng, nb] = hslToRgb(ph, ps, targetL);
      out[i] = nr;
      out[i + 1] = ng;
      out[i + 2] = nb;
      out[i + 3] = src[i + 3];
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(out, width, height), 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
