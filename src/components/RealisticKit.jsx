import React, { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { analyzeTexture, applyKitTexture } from '../utils/recolor';
import { createDecalTexture } from '../utils/decals';

export const MODEL_URL = process.env.PUBLIC_URL + '/models/psg-jordan-kit.glb';

/**
 * The source GLB is a fixed photogrammetry scan of a real kit (baked
 * logos/shading, no per-garment material split). We can't isolate "sleeves"
 * vs "body" as separate paintable regions, but every fabric material shares
 * the same base navy hue, so a single pass across all of them can strip the
 * original color (erasing the baked branding) and repaint it with a chosen
 * pattern — applied uniformly across the whole kit rather than per garment.
 */
function useRecolorableModel() {
  const { scene } = useGLTF(MODEL_URL);

  return useMemo(() => {
    const object = scene.clone(true);
    const targets = [];

    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = child.material.clone();
      const map = child.material.map;
      if (map) {
        targets.push({
          material: child.material,
          analysis: analyzeTexture(map.image),
          sampler: {
            wrapS: map.wrapS,
            wrapT: map.wrapT,
            repeat: map.repeat.clone(),
            offset: map.offset.clone(),
            center: map.center.clone(),
            rotation: map.rotation,
            flipY: map.flipY,
            colorSpace: map.colorSpace,
            anisotropy: map.anisotropy,
          },
        });
      }
    });

    const box = new THREE.Box3().setFromObject(object);
    return { object, targets, box };
  }, [scene]);
}

export default function RealisticKit({ pattern, primary, secondary, decals }) {
  const { object, targets, box } = useRecolorableModel();

  useEffect(() => {
    targets.forEach(({ material, analysis, sampler }) => {
      const previous = material.map;
      const next = applyKitTexture(analysis, { pattern, primary, secondary });
      next.wrapS = sampler.wrapS;
      next.wrapT = sampler.wrapT;
      next.repeat.copy(sampler.repeat);
      next.offset.copy(sampler.offset);
      next.center.copy(sampler.center);
      next.rotation = sampler.rotation;
      next.flipY = sampler.flipY;
      next.colorSpace = sampler.colorSpace;
      next.anisotropy = sampler.anisotropy;
      next.needsUpdate = true;
      material.map = next;
      material.needsUpdate = true;
      if (previous && previous.isCanvasTexture) previous.dispose();
    });
  }, [pattern, primary, secondary, targets]);

  useEffect(
    () => () => {
      targets.forEach(({ material }) => {
        if (material.map) material.map.dispose();
        material.dispose();
      });
    },
    [targets]
  );

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // The shirt occupies roughly the top ~45% of the whole kit's bounding box.
  const chestY = box.max.y - size.y * 0.16;
  const decalWidth = size.x * 0.42;
  const decalDepth = Math.max(size.z * 0.02, 0.004);

  const frontTexture = useMemo(
    () =>
      decals.sponsorText || decals.sponsorImage
        ? createDecalTexture({
            sponsorText: decals.sponsorText,
            sponsorColor: decals.sponsorColor,
            sponsorImage: decals.sponsorImage,
          })
        : null,
    [decals.sponsorText, decals.sponsorColor, decals.sponsorImage]
  );

  const backTexture = useMemo(
    () =>
      decals.backName || decals.backNumber
        ? createDecalTexture({
            backName: decals.backName,
            backNumber: decals.backNumber,
            numberColor: decals.numberColor,
          })
        : null,
    [decals.backName, decals.backNumber, decals.numberColor]
  );

  return (
    <group>
      <primitive object={object} />
      {frontTexture && (
        <mesh position={[center.x, chestY, box.max.z + decalDepth]}>
          <planeGeometry args={[decalWidth, decalWidth]} />
          <meshStandardMaterial map={frontTexture} transparent roughness={0.9} />
        </mesh>
      )}
      {backTexture && (
        <mesh position={[center.x, chestY, box.min.z - decalDepth]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[decalWidth, decalWidth]} />
          <meshStandardMaterial map={backTexture} transparent roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

useGLTF.preload(MODEL_URL);
