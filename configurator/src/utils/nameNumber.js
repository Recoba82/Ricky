import * as THREE from 'three';

/**
 * Texture trasparente con nome sulle spalle (in alto) e numero grande al
 * centro, da proiettare come decal sul retro della maglia.
 */
export function createNameNumberTexture({ name = '', number = '', color = '#ffffff' }) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.textAlign = 'center';
  ctx.fillStyle = color;

  if (name) {
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 64px "Arial Black", Arial, sans-serif';
    ctx.fillText(name.toUpperCase(), size / 2, size * 0.16, size * 0.9);
  }

  if (number !== '' && number !== null && number !== undefined) {
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 280px "Arial Black", Arial, sans-serif';
    ctx.fillText(String(number), size / 2, size * 0.58, size * 0.9);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
