import * as THREE from 'three';

const SIZE = 512;

/** Transparent canvas with sponsor logo/text and/or back name+number. */
export function createDecalTexture({
  sponsorText,
  sponsorColor = '#ffffff',
  sponsorImage,
  backName,
  backNumber,
  numberColor = '#ffffff',
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (sponsorImage) {
    const w = SIZE * 0.6;
    const h = w * (sponsorImage.height / sponsorImage.width || 1);
    ctx.drawImage(sponsorImage, (SIZE - w) / 2, (SIZE - h) / 2, w, Math.min(h, SIZE * 0.4));
  } else if (sponsorText) {
    ctx.fillStyle = sponsorColor;
    ctx.font = 'bold 60px "Arial Black", Arial, sans-serif';
    ctx.fillText(sponsorText, SIZE / 2, SIZE / 2);
  }

  if (backName) {
    ctx.fillStyle = numberColor;
    ctx.font = 'bold 54px Arial, sans-serif';
    ctx.fillText(backName.toUpperCase(), SIZE / 2, SIZE * 0.22);
  }

  if (backNumber !== undefined && backNumber !== null && backNumber !== '') {
    ctx.fillStyle = numberColor;
    ctx.font = 'bold 220px Arial, sans-serif';
    ctx.fillText(String(backNumber), SIZE / 2, SIZE * 0.62);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
