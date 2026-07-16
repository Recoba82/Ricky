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
import { createNameTexture, createNumberTexture } from '../utils/nameNumber';
import { ensureFontLoaded } from '../utils/fonts';
import { decalAnchors, computeDecalTransform } from '../utils/decalGeometry';

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

  // Un bersaglio di proiezione per parte: la mesh più voluminosa di quella
  // parte (le scansioni hanno più gusci sovrapposti, es. fodera interna dei
  // pantaloncini, e il decal va sul guscio esterno).
  const decalTargets = {};
  const bestVol = {};
  for (const t of targets) {
    const s = t.box.getSize(new THREE.Vector3());
    const vol = s.x * s.y * s.z;
    if (vol > (bestVol[t.part] ?? 0)) {
      bestVol[t.part] = vol;
      decalTargets[t.part] = t;
    }
  }

  return { root, targets, kitBox, decalTargets };
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

/**
 * Texture di testo (nome o numero): il font va atteso prima di disegnare,
 * altrimenti il canvas userebbe il fallback.
 */
function useTextTexture(make, cfg, enabled) {
  const [texture, setTexture] = useState(null);
  const key = `${cfg.text}|${cfg.fontId}|${cfg.color}|${cfg.outlineColor}|${cfg.outlineWidth}`;

  useEffect(() => {
    if (!enabled) {
      setTexture(null);
      return undefined;
    }
    let cancelled = false;
    ensureFontLoaded(cfg.fontId).then(() => {
      if (cancelled) return;
      setTexture(make(cfg));
    });
    return () => {
      cancelled = true;
    };
    // `key` riassume tutti i campi di cfg che influenzano il disegno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(
    () => () => {
      if (texture) texture.dispose();
    },
    [texture]
  );

  return texture;
}

/** Rende una decal per ogni ancora della posizione scelta. */
function DecalGroup({ texture, position, cfg, decalTargets, kitBox }) {
  const anchors = useMemo(() => decalAnchors(position, kitBox), [position, kitBox]);

  return anchors.map((anchor, i) => {
    const target = decalTargets[anchor.part];
    if (!target || !texture) return null;
    const t = computeDecalTransform(cfg, anchor, target, kitBox);
    if (!t) return null;
    return createPortal(
      <Decal key={i} position={t.position} rotation={t.rotation} scale={t.scale} renderOrder={10}>
        <meshBasicMaterial
          map={texture}
          transparent
          toneMapped={false}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-16}
        />
      </Decal>,
      target.mesh
    );
  });
}

function LogoDecal({ cfg, decalTargets, kitBox }) {
  const texture = useDecalTexture(cfg.src);
  return (
    <DecalGroup
      texture={texture}
      position={cfg.position}
      cfg={cfg}
      decalTargets={decalTargets}
      kitBox={kitBox}
    />
  );
}

function LetteringDecal({ make, cfg, decalTargets, kitBox }) {
  const texture = useTextTexture(make, cfg, cfg.text !== '' && cfg.text != null);
  return (
    <DecalGroup
      texture={texture}
      position={cfg.position}
      cfg={{ ...cfg, x: 0, y: 0, rotation: 0 }}
      decalTargets={decalTargets}
      kitBox={kitBox}
    />
  );
}

/* ---------- Componente principale ---------- */

export default function ShirtModel() {
  const { scene } = useGLTF(MODEL_URL);
  const { root, targets, kitBox, decalTargets } = useMemo(() => prepareModel(scene), [scene]);

  const parts = useKitStore((s) => s.parts);
  const patterns = useKitStore((s) => s.patterns);
  const finish = useKitStore((s) => s.finish);
  const decals = useKitStore((s) => s.decals);
  const lettering = useKitStore((s) => s.lettering);
  const playerName = useKitStore((s) => s.playerName);
  const playerNumber = useKitStore((s) => s.playerNumber);

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
      {Object.entries(decals).map(([slot, cfg]) =>
        cfg.src ? (
          <LogoDecal key={slot} cfg={cfg} decalTargets={decalTargets} kitBox={kitBox} />
        ) : null
      )}
      <LetteringDecal
        make={createNumberTexture}
        cfg={{ ...lettering, ...playerNumber }}
        decalTargets={decalTargets}
        kitBox={kitBox}
      />
      <LetteringDecal
        make={createNameTexture}
        cfg={{ ...lettering, ...playerName }}
        decalTargets={decalTargets}
        kitBox={kitBox}
      />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
