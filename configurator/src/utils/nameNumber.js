import * as THREE from 'three';
import { fontString } from './fonts';

const SIZE = 512;

function drawGlyphs(ctx, text, cfg, sizePx) {
  ctx.font = fontString(cfg.fontId, sizePx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const x = SIZE / 2;
  const y = SIZE / 2;
  const maxW = SIZE * 0.92;

  if (cfg.outlineWidth > 0) {
    ctx.strokeStyle = cfg.outlineColor;
    // lineWidth è centrato sul tracciato: raddoppio così lo spessore
    // richiesto resta interamente visibile fuori dalla lettera.
    ctx.lineWidth = cfg.outlineWidth * 2;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(text, x, y, maxW);
  }

  ctx.fillStyle = cfg.color;
  ctx.fillText(text, x, y, maxW);
}

function toTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  return canvas;
}

/** Texture trasparente con il solo numero, centrato. */
export function createNumberTexture(cfg) {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  // Un numero a due cifre riempie il riquadro; a una cifra resta più grande.
  const sizePx = String(cfg.text).length > 1 ? 380 : 440;
  drawGlyphs(ctx, String(cfg.text), cfg, sizePx);
  return toTexture(canvas);
}

/** Texture trasparente con il solo nome, centrato. */
export function createNameTexture(cfg) {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  drawGlyphs(ctx, String(cfg.text).toUpperCase(), cfg, 150);
  return toTexture(canvas);
}
