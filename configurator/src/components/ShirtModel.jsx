import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from '@react-three/fiber';
import { useGLTF, Decal } from '@react-three/drei';
import * as THREE from 'three';
import { useKitStore } from '../store';
import {
  analyzeTexture,
  repaintTexture,
  extractSampler,
  applySampler,
  getMeshNormalTexture,
} from '../utils/patterns';
import { createNameNumberTexture } from '../utils/nameNumber';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/psg-jordan-kit.glb`;

/* ---------- Classificazione mesh -> parte del kit ---------- */

const NAME_RULES = [
  [/collar|collo/i, 'collar'],
  [/cuff|polsin/i, 'cuffs'],
  [/sleeve|manic/i, 'sleeves'],
  [/short|pant/i, 'shorts'],
  [/sock|calz/i, 'socks'],
  [/body|shirt|magli|torso/i, 'body'],
];

function classifyMesh(mesh, meshBox, kitBox) {
  const names = [mesh.name, mesh.parent?.name ?? ''];
  for (const [re, part] of NAME_RULES) {
    if (names.some((n) => re.test(n))) return part;
  }
  // Fallback per scansioni senza nomi: posizione verticale del baricentro.
  // Soglie tarate sui bounding box del kit reale: calzettoni in basso
  // (centro ~0.16), pantaloncini + fascia vita al centro (~0.52-0.66),
  // colletto come sottile fascia in cima (~0.97), maglia il resto (~0.79).
  const kitSize = kitBox.getSize(new THREE.Vector3());
  const center = meshBox.getCenter(new THREE.Vector3());
  const relY = (center.y - kitBox.min.y) / kitSize.y;
  if (relY < 0.35) return 'socks';
  if (relY < 0.7) return 'shorts';
  if (relY > 0.93) return 'collar';
  return 'body';
}

/**
 * Clona la scena, classifica ogni mesh in una parte del kit, clona i
 * materiali (per non condividere stato tra mesh) e analizza le texture una
 * sola volta. Salva anche la matrice world di ogni mesh relativa alla radice
 * (calcolata da scena staccata), che serve per convertire le ancore dei
 * decal in coordinate locali della mesh bersaglio.
 */
function prepareModel(scene) {
  const root = scene.clone(true);
  root.updateMatrixWorld(true);
  const kitBox = new THREE.Box3().setFromObject(root);

  const targets = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.material = child.material.clone();
    const meshBox = new THREE.Box3().setFromObject(child);
    const part = classifyMesh(child, meshBox, kitBox);
    const map = child.material.map;
    targets.push({
      mesh: child,
      part,
      box: meshBox,
      matrixRel: child.matrixWorld.clone(),
      analysis: map ? analyzeTexture(map.image) : null,
      sampler: map ? extractSampler(map) : null,
    });
  });

  let decalTarget = null;
  let bestVol = 0;
  for (const t of targets) {
    if (t.part !== 'body') continue;
    const s = t.box.getSize(new THREE.Vector3());
    const vol = s.x * s.y * s.z;
    if (vol > bestVol) {
      bestVol = vol;
      decalTarget = t;
    }
  }

  return { root, targets, kitBox, decalTarget };
}

/* ---------- Calcolo trasformazioni decal ---------- */

/**
 * Ancore di proiezione in coordinate della scena (pre-normalizzazione).
 * `p` è il punto sulla superficie, `dir` la direzione di proiezione,
 * `ax`/`ay` gli assi lungo cui si muovono gli offset X/Y dell'utente.
 */
function decalAnchor(position, kitBox) {
  const size = kitBox.getSize(new THREE.Vector3());
  const c = kitBox.getCenter(new THREE.Vector3());
  const chestY = kitBox.min.y + size.y * 0.79;
  const badgeY = kitBox.min.y + size.y * 0.85;
  switch (position) {
    case 'chest-left':
      return {
        p: new THREE.Vector3(c.x - size.x * 0.13, badgeY, kitBox.max.z),
        dir: new THREE.Vector3(0, 0, 1),
        ax: new THREE.Vector3(1, 0, 0),
        ay: new THREE.Vector3(0, 1, 0),
      };
    case 'chest-right':
      return {
        p: new THREE.Vector3(c.x + size.x * 0.13, badgeY, kitBox.max.z),
        dir: new THREE.Vector3(0, 0, 1),
        ax: new THREE.Vector3(1, 0, 0),
        ay: new THREE.Vector3(0, 1, 0),
      };
    case 'sleeve-left':
      return {
        p: new THREE.Vector3(kitBox.min.x, badgeY, c.z),
        dir: new THREE.Vector3(-1, 0, 0),
        ax: new THREE.Vector3(0, 0, -1),
        ay: new THREE.Vector3(0, 1, 0),
      };
    case 'sleeve-right':
      return {
        p: new THREE.Vector3(kitBox.max.x, badgeY, c.z),
        dir: new THREE.Vector3(1, 0, 0),
        ax: new THREE.Vector3(0, 0, 1),
        ay: new THREE.Vector3(0, 1, 0),
      };
    case 'back-center':
      return {
        p: new THREE.Vector3(c.x, kitBox.min.y + size.y * 0.76, kitBox.min.z),
        dir: new THREE.Vector3(0, 0, -1),
        ax: new THREE.Vector3(-1, 0, 0),
        ay: new THREE.Vector3(0, 1, 0),
      };
    default:
      return {
        p: new THREE.Vector3(c.x, chestY, kitBox.max.z),
        dir: new THREE.Vector3(0, 0, 1),
        ax: new THREE.Vector3(1, 0, 0),
        ay: new THREE.Vector3(0, 1, 0),
      };
  }
}

/**
 * Converte l'ancora (spazio scena) in posizione/rotazione/scala locali alla
 * mesh bersaglio, usando la matrice relativa salvata in preparazione. La
 * rotazione allinea l'asse Z del decal alla direzione di proiezione
 * (worldToLocal della direzione) e aggiunge lo spin utente attorno ad essa.
 */
function computeDecalTransform(cfg, decalTarget, kitBox) {
  const size = kitBox.getSize(new THREE.Vector3());
  const { p, dir, ax, ay } = decalAnchor(cfg.position, kitBox);

  const anchor = p
    .clone()
    .addScaledVector(ax, cfg.x * size.x * 0.5)
    .addScaledVector(ay, cfg.y * size.y * 0.25);

  const inv = decalTarget.matrixRel.clone().invert();
  const posLocal = anchor.clone().applyMatrix4(inv);

  // Base esplicita del proiettore in spazio mondo (z = normale uscente,
  // y = alto, x = destra per chi guarda quella faccia): garantisce testo
  // dritto e non specchiato su ogni lato, incluso il retro — con
  // setFromUnitVectors il "roll" attorno alla direzione sarebbe arbitrario.
  const zAxis = dir.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const worldBasis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const meshRotInv = new THREE.Matrix4().extractRotation(inv);
  const localBasis = new THREE.Matrix4().multiplyMatrices(meshRotInv, worldBasis);

  const q = new THREE.Quaternion().setFromRotationMatrix(localBasis);
  q.multiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (cfg.rotation * Math.PI) / 180
    )
  );
  const e = new THREE.Euler().setFromQuaternion(q);

  // Fattore di conversione scena -> spazio locale mesh (misura di un
  // segmento noto trasformato), per mantenere la scala percepita costante.
  const probe = size.y * 0.01;
  const p2Local = anchor
    .clone()
    .add(new THREE.Vector3(0, probe, 0))
    .applyMatrix4(inv);
  const ratio = p2Local.sub(posLocal).length() / probe;
  const s = cfg.scale * size.y * ratio;

  return {
    position: [posLocal.x, posLocal.y, posLocal.z],
    rotation: [e.x, e.y, e.z],
    scale: [s, s, s * 0.3],
  };
}

/* ---------- Texture del logo caricato ---------- */

function useDecalTexture(src) {
  const [texture, setTexture] = useState(null);

  useEffect(() => {
    if (!src) {
      setTexture(null);
      return undefined;
    }
    let cancelled = false;
    new THREE.TextureLoader().load(src, (t) => {
      if (cancelled) {
        t.dispose();
        return;
      }
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      setTexture(t);
    });
    return () => {
      cancelled = true;
      setTexture((prev) => {
        if (prev) prev.dispose();
        return null;
      });
    };
  }, [src]);

  return texture;
}

function KitDecal({ cfg, decalTarget, kitBox }) {
  const texture = useDecalTexture(cfg.src);

  const transform = useMemo(
    () => computeDecalTransform(cfg, decalTarget, kitBox),
    [cfg.position, cfg.x, cfg.y, cfg.rotation, cfg.scale, decalTarget, kitBox]
  );

  if (!texture) return null;

  return (
    <Decal
      position={transform.position}
      rotation={transform.rotation}
      scale={transform.scale}
      renderOrder={10}
    >
      <meshBasicMaterial
        map={texture}
        transparent
        toneMapped={false}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-16}
      />
    </Decal>
  );
}

function BackNameNumber({ cfg, decalTarget, kitBox }) {
  const texture = useMemo(
    () =>
      cfg.name || cfg.number !== ''
        ? createNameNumberTexture({ name: cfg.name, number: cfg.number, color: cfg.color })
        : null,
    [cfg.name, cfg.number, cfg.color]
  );

  useEffect(
    () => () => {
      if (texture) texture.dispose();
    },
    [texture]
  );

  const transform = useMemo(
    () =>
      computeDecalTransform(
        { position: 'back-center', x: 0, y: 0, rotation: 0, scale: cfg.scale },
        decalTarget,
        kitBox
      ),
    [cfg.scale, decalTarget, kitBox]
  );

  if (!texture) return null;

  return (
    <Decal
      position={transform.position}
      rotation={transform.rotation}
      scale={transform.scale}
      renderOrder={10}
    >
      <meshBasicMaterial
        map={texture}
        transparent
        toneMapped={false}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-16}
      />
    </Decal>
  );
}

/* ---------- Componente principale ---------- */

export default function ShirtModel() {
  const { scene } = useGLTF(MODEL_URL);
  const { root, targets, kitBox, decalTarget } = useMemo(() => prepareModel(scene), [scene]);

  const parts = useKitStore((s) => s.parts);
  const patterns = useKitStore((s) => s.patterns);
  const finish = useKitStore((s) => s.finish);
  const decals = useKitStore((s) => s.decals);
  const backText = useKitStore((s) => s.backText);

  const { normScale, normPosition } = useMemo(() => {
    const size = kitBox.getSize(new THREE.Vector3());
    const center = kitBox.getCenter(new THREE.Vector3());
    const s = 2.4 / size.y;
    return {
      normScale: s,
      normPosition: [-center.x * s, -center.y * s, -center.z * s],
    };
  }, [kitBox]);

  // Repaint colori/pattern per parte (debounce: i colorpicker emettono raffiche).
  useEffect(() => {
    const timer = setTimeout(() => {
      targets.forEach(({ mesh, part, analysis, sampler }) => {
        const color = (parts[part] ?? parts.body).color;
        if (!analysis) {
          mesh.material.color.set(color);
          return;
        }
        const pattern = patterns[part] ?? { type: 'none', color: '#ffffff', scale: 8, opacity: 1 };
        const next = repaintTexture(analysis, { baseColor: color, pattern });
        applySampler(next, sampler);
        const prev = mesh.material.map;
        mesh.material.map = next;
        mesh.material.needsUpdate = true;
        if (prev && prev.isCanvasTexture) prev.dispose();
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [parts, patterns, targets]);

  // Finitura materiale.
  useEffect(() => {
    targets.forEach(({ mesh }) => {
      const m = mesh.material;
      if (finish === 'shiny') {
        m.roughness = 0.35;
        m.metalness = 0.15;
        m.normalMap = null;
      } else if (finish === 'mesh') {
        m.roughness = 0.8;
        m.metalness = 0.02;
        m.normalMap = getMeshNormalTexture();
        if (m.normalScale) m.normalScale.set(0.6, 0.6);
      } else {
        m.roughness = 0.92;
        m.metalness = 0;
        m.normalMap = null;
      }
      m.needsUpdate = true;
    });
  }, [finish, targets]);

  // Cleanup completo alla dismissione del modello.
  useEffect(
    () => () => {
      targets.forEach(({ mesh }) => {
        if (mesh.material.map && mesh.material.map.isCanvasTexture) mesh.material.map.dispose();
        mesh.material.dispose();
      });
    },
    [targets]
  );

  return (
    <group scale={normScale} position={normPosition}>
      <primitive object={root} />
      {decalTarget &&
        Object.entries(decals).map(([slot, cfg]) =>
          cfg.src
            ? createPortal(
                <KitDecal key={slot} cfg={cfg} decalTarget={decalTarget} kitBox={kitBox} />,
                decalTarget.mesh
              )
            : null
        )}
      {decalTarget &&
        (backText.name || backText.number !== '') &&
        createPortal(
          <BackNameNumber cfg={backText} decalTarget={decalTarget} kitBox={kitBox} />,
          decalTarget.mesh
        )}
    </group>
  );
}

useGLTF.preload(MODEL_URL);
