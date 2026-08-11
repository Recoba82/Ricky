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
import { placementAnchors, computeDecalTransforms } from '../utils/decalGeometry';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/psg-jordan-kit.glb`;

/** Logo dello sponsor tecnico: applicato sempre, non caricato dall'utente. */
export const TECH_LOGO_URL = `${import.meta.env.BASE_URL}logos/tech-logo.png`;

/**
 * Posizioni fisse del logo tecnico: fronte petto lato destro sulla maglia e in
 * basso a sinistra sul pantaloncino. Dimensione fissa 0.03.
 */
const TECH_LOGO_PLACEMENTS = [
  { part: 'body', face: 'front', x: 0.4, y: 0.42, rotation: 0, scale: 0.03, mirror: false },
  { part: 'shorts', face: 'front', x: -0.55, y: -0.4, rotation: 0, scale: 0.03, mirror: false },
];

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
 * Mappe del materiale originale che contengono il branding stampato della
 * scansione: oltre al colore, anche rugosita', metallicita', occlusione e
 * rilievo disegnano loghi e scritte, che restano visibili "tono su tono" sul
 * capo a tinta unita. Vengono azzerate tutte: il colore viene ridipinto da
 * repaintTexture e la trama del tessuto arriva dalla normal map procedurale.
 */
const BAKED_MAP_KEYS = [
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'lightMap',
  'bumpMap',
  'displacementMap',
  'specularMap',
  'alphaMap',
  'clearcoatMap',
  'sheenColorMap',
  'normalMap',
];

function stripBakedGraphics(material) {
  BAKED_MAP_KEYS.forEach((key) => {
    if (material[key]) material[key] = null;
  });
  if (material.emissive) material.emissive.set('#000000');
  material.needsUpdate = true;
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
    stripBakedGraphics(child.material);
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

  // Riquadro complessivo di ogni parte (unione delle sue mesh): è il
  // riferimento su cui gli offset X/Y del piazzamento libero sono espressi.
  const partBoxes = {};
  for (const t of targets) {
    partBoxes[t.part] = partBoxes[t.part]
      ? partBoxes[t.part].union(t.box)
      : t.box.clone();
  }

  return { root, targets, kitBox, decalTargets, partBoxes };
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

/** Rende una decal per ogni ancora del piazzamento (2 sui calzettoni speculari). */
function DecalGroup({ texture, cfg, targets, decalTargets, partBoxes, kitBox }) {
  const target = decalTargets[cfg.part];
  const partBox = partBoxes[cfg.part];

  // Tutte le mesh del kit: il decal viene proiettato su ognuna toccata dal
  // riquadro, cosi' la grafica non si taglia sulle cuciture ne' sui pannelli
  // (maniche destra/sinistra, bande, colletto) e resta sopra colore e pattern
  // di ogni parte.
  const shells = useMemo(
    () => (targets && targets.length > 0 ? targets : Object.values(decalTargets)),
    [targets, decalTargets]
  );

  const anchors = useMemo(
    () =>
      partBox
        ? placementAnchors(cfg, partBox, kitBox.getCenter(new THREE.Vector3()).x)
        : [],
    [cfg.part, cfg.face, cfg.x, cfg.y, cfg.mirror, partBox, kitBox]
  );

  return anchors.flatMap((anchor, i) => {
    if (!target || !texture) return [];
    return computeDecalTransforms(cfg, anchor, target, shells, kitBox).map((t, j) => (
      <React.Fragment key={i + '-' + j}>
        {createPortal(
          <Decal position={t.position} rotation={t.rotation} scale={t.scale} renderOrder={10}>
            <meshBasicMaterial
              map={texture}
              transparent
              toneMapped={false}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-16}
            />
          </Decal>,
          t.target.mesh
        )}
      </React.Fragment>
    ));
  });
}

function LogoDecal({ cfg, ...rest }) {
  const texture = useDecalTexture(cfg.src);
  return <DecalGroup texture={texture} cfg={cfg} {...rest} />;
}

function LetteringDecal({ make, cfg, ...rest }) {
  const texture = useTextTexture(make, cfg, cfg.text !== '' && cfg.text != null);
  return <DecalGroup texture={texture} cfg={cfg} {...rest} />;
}

/* ---------- Logo sponsor tecnico ---------- */

/**
 * Inchiostro del logo in base al colore base della parte: bianco sui fondi
 * scuri, blu notte sui fondi chiari, cosi' resta sempre leggibile.
 */
function luminance(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function techInk(baseHex, pattern) {
  let lum = luminance(baseHex);
  // Con un pattern attivo il marchio finirebbe spesso su una striscia del
  // colore pattern: la scelta tiene conto di entrambi i colori.
  if (pattern && pattern.type !== 'none' && pattern.opacity > 0) {
    const w = Math.min(1, pattern.opacity) * 0.5;
    lum = lum * (1 - w) + luminance(pattern.color) * w;
  }
  return lum > 0.25 ? '#0b1220' : '#ffffff';
}

/**
 * Il file del logo ha fondo bianco: i pixel chiari diventano trasparenti e il
 * resto viene riempito con l'inchiostro scelto, cosi' il marchio prende il
 * colore della parte su cui e' applicato.
 */
function useTintedTexture(src, color) {
  const [texture, setTexture] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || 256;
      const h = img.naturalHeight || 256;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
        const alpha = lum > 238 ? 0 : lum > 200 ? ((238 - lum) / 38) * 255 : 255;
        px[i + 3] = Math.min(px[i + 3], alpha);
      }
      ctx.putImageData(data, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      setTexture(t);
    };
    img.onerror = () => {
      if (!cancelled) setTexture(null);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, color]);

  useEffect(
    () => () => {
      if (texture) texture.dispose();
    },
    [texture]
  );

  return texture;
}

function TechLogo({ cfg, color, pattern, ...rest }) {
  const texture = useTintedTexture(TECH_LOGO_URL, techInk(color, pattern));
  return <DecalGroup texture={texture} cfg={cfg} {...rest} />;
}

/* ---------- Componente principale ---------- */

export default function ShirtModel() {
  const { scene } = useGLTF(MODEL_URL);
  const { root, targets, kitBox, decalTargets, partBoxes } = useMemo(
    () => prepareModel(scene),
    [scene]
  );
  const decalProps = { targets, decalTargets, partBoxes, kitBox };

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

  // Finitura materiale: la normal map di trama tessuto resta sempre attiva,
  // dà rilievo micro-superficiale realistico alla scansione fotogrammetrica
  // invece di una superficie piatta; cambia solo la sua intensità insieme a
  // ruvidità/metallicità in base alla finitura scelta dall'utente.
  useEffect(() => {
    const fabricNormal = getMeshNormalTexture();
    targets.forEach(({ mesh }) => {
      const m = mesh.material;
      m.normalMap = fabricNormal;
      if (finish === 'shiny') {
        m.roughness = 0.35;
        m.metalness = 0.15;
        if (m.normalScale) m.normalScale.set(0.25, 0.25);
      } else if (finish === 'mesh') {
        m.roughness = 0.8;
        m.metalness = 0.02;
        if (m.normalScale) m.normalScale.set(0.6, 0.6);
      } else {
        m.roughness = 0.85;
        m.metalness = 0;
        if (m.normalScale) m.normalScale.set(0.35, 0.35);
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
        cfg.src ? <LogoDecal key={slot} cfg={cfg} {...decalProps} /> : null
      )}
      {TECH_LOGO_PLACEMENTS.map((cfg, i) => (
        <TechLogo
          key={'tech-' + i}
          cfg={cfg}
          color={(parts[cfg.part] ?? parts.body).color}
          pattern={patterns[cfg.part]}
          {...decalProps}
        />
      ))}
      <LetteringDecal
        make={createNumberTexture}
        cfg={{ ...lettering, ...playerNumber }}
        {...decalProps}
      />
      <LetteringDecal
        make={createNameTexture}
        cfg={{ ...lettering, ...playerName }}
        {...decalProps}
      />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
