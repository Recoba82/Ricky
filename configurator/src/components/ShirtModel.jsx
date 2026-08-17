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
  getRibNormalTexture,
} from '../utils/patterns';
import { createNameTexture, createNumberTexture } from '../utils/nameNumber';
import { ensureFontLoaded } from '../utils/fonts';
import { placementAnchors, computeDecalTransforms } from '../utils/decalGeometry';
import {
  buildRingBand,
  buildStraightRibbon,
  buildCollarLapel,
  necklinePoint,
} from '../utils/collarGeometry';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/psg-jordan-kit.glb`;

/** Logo dello sponsor tecnico: applicato sempre, non caricato dall'utente. */
export const TECH_LOGO_URL = `${import.meta.env.BASE_URL}logos/tech-logo.png`;

/**
 * Posizioni fisse del logo tecnico (TeamWear): fronte petto lato destro sulla
 * maglia e in basso a sinistra sul pantaloncino. Dimensione fissa 0.03.
 */
const TECH_LOGO_PLACEMENTS = [
  { part: 'body', face: 'front', x: -0.42, y: 0.58, rotation: 0, scale: 0.03, mirror: false },
  { part: 'shorts', face: 'front', x: 0.94, y: -1, rotation: 0, scale: 0.03, mirror: false },
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

/** Colore dell'interno (fodera) di ogni parte del kit, vista dall'interno dei bordi aperti. */
const INTERIOR_COLOR = new THREE.Color('#8a8a8a');

/**
 * Ogni mesh della scansione e' un guscio a faccia singola: normalmente,
 * guardando dentro colletto, giromanica o gambali, si vede il vuoto perche'
 * le backface non vengono disegnate. Questa funzione rende ogni parte a
 * doppia faccia con un "interno" grigio realistico (stessa normal map di
 * tessuto, ruvidita' piu' alta) e aggiunge, sul bordo esterno del modello
 * (dove la normale e' quasi perpendicolare alla vista), un'ombra scura e
 * sfumata che ne marca il profilo — un effetto rim/fresnel via
 * onBeforeCompile, perche' la mesh non ha una AO map propria (rimossa in
 * stripBakedGraphics) su cui disegnarla.
 */
function applyShellRealism(material) {
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInteriorColor = { value: INTERIOR_COLOR };
    shader.uniforms.uEdgeStrength = { value: 0.65 };
    shader.uniforms.uEdgeSoftness = { value: 0.3 };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShellViewPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvShellViewPos = -mvPosition.xyz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vShellViewPos;\nuniform vec3 uInteriorColor;\nuniform float uEdgeStrength;\nuniform float uEdgeSoftness;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if ( !gl_FrontFacing ) {
          diffuseColor.rgb = uInteriorColor;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if ( !gl_FrontFacing ) {
          roughnessFactor = 0.92;
        }`
      )
      // L'ombra perimetrale usa la normale "geometrica" (pre normal-map),
      // catturata subito dopo <normal_fragment_begin>: usare la normale gia'
      // perturbata dal normal map di tessuto darebbe un bordo sporco e
      // puntinato invece che una sfumatura morbida.
      .replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nvec3 shellGeoNormal = normal;'
      )
      .replace(
        '#include <dithering_fragment>',
        `vec3 shellViewDir = normalize( vShellViewPos );
        float shellRim = 1.0 - max( dot( shellGeoNormal, shellViewDir ), 0.0 );
        float shellMask = smoothstep( uEdgeSoftness, 1.0, shellRim );
        gl_FragColor.rgb *= mix( 1.0, 1.0 - uEdgeStrength, shellMask );
        #include <dithering_fragment>`
      );
  };
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
    applyShellRealism(child.material);
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

/* ---------- Colletto: varianti procedurali Polo / V ---------- */

const COLLAR_PLACKET_GAP = 0.012;
const COLLAR_PLACKET_LEN = 0.2;
// Il petto si allontana dal collo scendendo verso il basso: uno scarto in
// avanti fisso farebbe affondare il placket/i bottoni piu' bassi dentro la
// maglia. Questo offset cresce con la distanza dal colletto per restare
// sempre davanti alla superficie del corpo.
const COLLAR_PLACKET_BULGE = 0.05;
// Angoli spalla condivisi da Polo e V: aprono la fascia sul davanti (il
// resto del giro, dalla spalla sinistra alla destra passando per il retro,
// resta chiuso). Per la Polo l'apertura viene richiusa dalle due falde
// piatte (vedi buildCollarLapel); per il V resta aperta a "V".
const SHOULDER_L = 130;
const SHOULDER_R = 50;
const VNECK_DEPTH = 0.16;
// Fascia (collar stand) della Polo: stretta e aderente al collo, non un
// bordo largo, cosi' non "svolazza" come un colletto a scialle.
const POLO_BAND_OUTER_OFFSET = 0.012;

/**
 * Costruisce le geometrie procedurali del colletto scelto, seguendo il
 * profilo reale dello scollo campionato dalla mesh originale (vedi
 * utils/collarGeometry.js). "Girocollo" non genera nulla: usa la mesh
 * scansionata cosi' com'e'.
 */
function useCollarGeometry(style) {
  return useMemo(() => {
    if (style === 'polo') {
      // La fascia segue solo spalla-retro-spalla (come il V): il davanti,
      // dove prima si chiudeva ad anello intero creando un colletto a
      // scialle sovradimensionato, e' ora coperto dalle due falde piatte
      // che si incontrano sopra il primo bottone, come un vero collo polo.
      const band = buildRingBand({
        angleFrom: SHOULDER_L,
        angleTo: SHOULDER_R + 360,
        outerOffset: POLO_BAND_OUTER_OFFSET,
        riseY: 0.005,
      });
      const top = necklinePoint(90, 'inner', 0.004);
      const bottom = new THREE.Vector3(
        top.x,
        top.y - COLLAR_PLACKET_LEN,
        top.z + COLLAR_PLACKET_BULGE
      );
      // Punto lungo il placket a parametro `t`, con uno scarto extra in
      // avanti (oltre al bulge del nastro) cosi' bottoni e cuciture restano
      // sempre leggibili sopra il tessuto invece di affondarci dentro.
      const placketPoint = (t, extraZ) =>
        top.clone().lerp(bottom, t).add(new THREE.Vector3(0, 0, extraZ));
      // Le due bande del placket si fermano subito sotto l'ultimo bottone
      // (non fino in fondo a `bottom`, che serve solo come riferimento per
      // spaziare i bottoni): oltre restava un lembo isolato senza bottoni.
      const ribbonEnd = top.clone().lerp(bottom, 0.78);

      const left = buildStraightRibbon(
        top.clone().add(new THREE.Vector3(-COLLAR_PLACKET_GAP, 0.006, 0)),
        ribbonEnd.clone().add(new THREE.Vector3(-COLLAR_PLACKET_GAP, 0, 0))
      );
      const right = buildStraightRibbon(
        top.clone().add(new THREE.Vector3(COLLAR_PLACKET_GAP, 0.006, 0)),
        ribbonEnd.clone().add(new THREE.Vector3(COLLAR_PLACKET_GAP, 0, 0))
      );
      const lapelLeft = buildCollarLapel({
        shoulderAngle: SHOULDER_L,
        apex: top,
        bandOuterOffset: POLO_BAND_OUTER_OFFSET,
      });
      const lapelRight = buildCollarLapel({
        shoulderAngle: SHOULDER_R,
        apex: top,
        bandOuterOffset: POLO_BAND_OUTER_OFFSET,
      });
      // Bottone: disco piatto (non piu' una sfera) con un sottile bordo a
      // toro per leggere il profilo, orientato verso l'esterno (+Z).
      const buttonGeo = new THREE.CylinderGeometry(0.0075, 0.0075, 0.003, 20).rotateX(Math.PI / 2);
      const buttonRimGeo = new THREE.TorusGeometry(0.0078, 0.0011, 8, 20);
      // Due bottoni ben distanziati lungo il placket (il primo appena sotto
      // le falde, il secondo piu' in basso sul petto), entrambi spinti
      // abbastanza in avanti da restare sempre visibili sopra il tessuto.
      const buttons = [0.28, 0.68].map((t) => placketPoint(t, 0.02 + t * 0.025));
      return {
        style,
        band,
        ribbons: [left, right],
        lapels: [lapelLeft, lapelRight],
        buttonGeo,
        buttonRimGeo,
        buttons,
      };
    }
    if (style === 'v') {
      const band = buildRingBand({ angleFrom: SHOULDER_L, angleTo: SHOULDER_R + 360 });
      const shoulderL = necklinePoint(SHOULDER_L, 'inner', 0.004);
      const shoulderR = necklinePoint(SHOULDER_R, 'inner', 0.004);
      const front = necklinePoint(90, 'inner', 0.004);
      const apex = new THREE.Vector3(front.x, front.y - VNECK_DEPTH, front.z + 0.03);
      const legL = buildStraightRibbon(shoulderL, apex, 0.02);
      const legR = buildStraightRibbon(shoulderR, apex, 0.02);
      return { style, band, ribbons: [legL, legR] };
    }
    return null;
  }, [style]);
}

/**
 * Renderizza la fascia del colletto procedurale (Polo o V) con lo stesso
 * trattamento materico delle altre parti: colore scelto per il colletto
 * (sempre il fattore colore base del materiale, mai attenuato da una
 * texture sotto, cosi' resta il primo elemento leggibile a colpo d'occhio),
 * ruvidita' coerente con la finitura corrente e, sulla Polo, una normal map
 * a costine dedicata al posto della trama generica del tessuto.
 */
function CollarOverlay({ style, color, finish }) {
  const geo = useCollarGeometry(style);

  const materialProps = useMemo(() => {
    const base = { color, side: THREE.DoubleSide };
    if (finish === 'shiny') return { ...base, roughness: 0.35, metalness: 0.15 };
    if (finish === 'mesh') return { ...base, roughness: 0.8, metalness: 0.02 };
    return { ...base, roughness: 0.85, metalness: 0 };
  }, [color, finish]);

  // Due varianti della stessa normal map a costine: piu' fitta sulla fascia
  // stretta intorno al collo, piu' rada sulle falde piatte, cosi' le coste
  // sembrano proseguire in scala naturale invece di strizzarsi o sparire.
  const ribBandNormal = useMemo(() => {
    const t = getRibNormalTexture().clone();
    t.repeat.set(26, 1);
    t.needsUpdate = true;
    return t;
  }, []);
  const ribLapelNormal = useMemo(() => {
    const t = getRibNormalTexture().clone();
    t.repeat.set(5, 1);
    t.needsUpdate = true;
    return t;
  }, []);
  const fabricNormal = useMemo(() => getMeshNormalTexture(), []);

  if (!geo) return null;

  const isPolo = style === 'polo';

  return (
    <group>
      <mesh geometry={geo.band} castShadow receiveShadow>
        <meshStandardMaterial
          {...materialProps}
          normalMap={isPolo ? ribBandNormal : fabricNormal}
          normalScale={isPolo ? [0.8, 0.8] : [0.35, 0.35]}
        />
      </mesh>
      {geo.lapels?.map((g, i) => (
        <mesh key={'lapel-' + i} geometry={g} castShadow receiveShadow>
          <meshStandardMaterial {...materialProps} normalMap={ribLapelNormal} normalScale={[0.6, 0.6]} />
        </mesh>
      ))}
      {geo.ribbons.map((g, i) => (
        <mesh key={i} geometry={g} castShadow receiveShadow>
          <meshStandardMaterial {...materialProps} normalMap={fabricNormal} normalScale={[0.35, 0.35]} />
        </mesh>
      ))}
      {geo.buttons?.map((p, i) => (
        <group key={i} position={p}>
          <mesh geometry={geo.buttonGeo} castShadow>
            <meshStandardMaterial color="#1b1e24" roughness={0.35} metalness={0.45} />
          </mesh>
          <mesh geometry={geo.buttonRimGeo} castShadow>
            <meshStandardMaterial color="#0b0d11" roughness={0.5} metalness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
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
  const collarStyle = useKitStore((s) => s.collarStyle);
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

  // Stile colletto: la mesh scansionata (girocollo) resta l'unica visibile
  // di default; per Polo e V viene nascosta e sostituita dalla fascia
  // procedurale renderizzata da CollarOverlay.
  useEffect(() => {
    targets.forEach(({ mesh, part }) => {
      if (part === 'collar') mesh.visible = collarStyle === 'girocollo';
    });
  }, [collarStyle, targets]);

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
      {collarStyle !== 'girocollo' && (
        <CollarOverlay style={collarStyle} color={parts.collar.color} finish={finish} />
      )}
    </group>
  );
}

useGLTF.preload(MODEL_URL);
