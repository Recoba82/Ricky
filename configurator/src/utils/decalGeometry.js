import * as THREE from 'three';

/**
 * Assi del proiettore per ogni lato del capo.
 * `dir` = normale uscente, `ax` = destra per chi guarda quel lato,
 * `ay` = alto. Con `ax` esplicito il testo non risulta mai specchiato.
 */
const FACES = {
  front: { dir: [0, 0, 1], ax: [1, 0, 0], ay: [0, 1, 0] },
  back: { dir: [0, 0, -1], ax: [-1, 0, 0], ay: [0, 1, 0] },
  left: { dir: [-1, 0, 0], ax: [0, 0, -1], ay: [0, 1, 0] },
  right: { dir: [1, 0, 0], ax: [0, 0, 1], ay: [0, 1, 0] },
};

/**
 * Profondità della scatola di proiezione: frazione del lato del decal, con un
 * tetto in frazione dell'altezza del kit. Abbastanza spessa da coprire
 * cuciture e curvature (spalle, fianchi) senza arrivare a stampare la grafica
 * sulla superficie opposta del capo.
 */
const DEPTH_RATIO = 1;
const DEPTH_MAX_KIT = 0.08;

/** Raggio della sfera che racchiude il riquadro del decal, in frazione del lato. */
const FOOTPRINT_RADIUS = 0.75;

/** Semi-estensione della scatola lungo un asse unitario allineato agli assi. */
function halfExtent(size, axis) {
  return (Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z) / 2;
}

/**
 * Punti di mira per un piazzamento libero: si sceglie la parte del kit e il
 * lato, poi `x`/`y` (entrambi in -1..1) spostano il decal sulla superficie di
 * quella parte, dal centro fino ai bordi.
 *
 * Ritorna un array perché i calzettoni ricevono un'istanza per gambale: il
 * riquadro della parte viene diviso a metà sulla X del kit e il decal è
 * piazzato sullo stesso punto relativo di ciascuna gamba.
 */
export function placementAnchors(cfg, partBox, kitCenterX) {
  const face = FACES[cfg.face] ?? FACES.front;
  const dir = new THREE.Vector3(...face.dir);
  const ax = new THREE.Vector3(...face.ax);
  const ay = new THREE.Vector3(...face.ay);

  const boxes = cfg.mirror
    ? [
        new THREE.Box3(
          partBox.min.clone(),
          new THREE.Vector3(kitCenterX, partBox.max.y, partBox.max.z)
        ),
        new THREE.Box3(
          new THREE.Vector3(kitCenterX, partBox.min.y, partBox.min.z),
          partBox.max.clone()
        ),
      ]
    : [partBox];

  return boxes.map((box) => {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Margine: al valore estremo il decal resta dentro il capo invece di
    // finire a cavallo del bordo.
    const spanX = halfExtent(size, ax) * 0.8;
    const spanY = halfExtent(size, ay) * 0.8;

    const p = center
      .clone()
      .addScaledVector(ax, cfg.x * spanX)
      .addScaledVector(ay, cfg.y * spanY);

    return { p, dir, ax, ay };
  });
}

/** Mesh sonda per il raycast, posizionata come la mesh bersaglio. */
function makeProbe(target) {
  const probe = new THREE.Mesh(target.mesh.geometry);
  target.matrixRel.decompose(probe.position, probe.quaternion, probe.scale);
  probe.updateMatrixWorld(true);
  return probe;
}

/**
 * Trova il punto reale della superficie sotto il punto di mira, sparando un
 * raggio da fuori il kit lungo la direzione di proiezione. Serve perché la
 * sola quota del riquadro non basta: i pantaloncini rientrano rispetto al
 * petto e le calze hanno i piedi che sporgono in avanti, quindi un punto
 * ricavato dal riquadro cadrebbe nel vuoto e non verrebbe proiettato nulla.
 *
 * Se il bersaglio principale non viene colpito (decal spinto su una cucitura
 * o sul bordo del capo) si ripiega sulle altre mesh del kit, così la grafica
 * resta visibile invece di sparire.
 */
function projectOntoSurface(point, dir, primaryTarget, fallbackTargets, reach) {
  const origin = point.clone().addScaledVector(dir, reach);
  const raycaster = new THREE.Raycaster(origin, dir.clone().negate(), 0, reach * 2);

  const order = [primaryTarget, ...fallbackTargets.filter((t) => t !== primaryTarget)];
  for (const target of order) {
    const hits = raycaster.intersectObject(makeProbe(target), false);
    if (hits.length > 0) return hits[0].point.clone();
  }
  return null;
}

/**
 * Converte il punto di proiezione (spazio scena) in posizione/rotazione/scala
 * locali alla mesh indicata.
 */
function localTransform(cfg, hit, dir, target, kitSizeY) {
  const inv = target.matrixRel.clone().invert();
  const posLocal = hit.clone().applyMatrix4(inv);

  // Base esplicita del proiettore in spazio mondo, poi portata nello spazio
  // locale della mesh: garantisce testo dritto e non specchiato su ogni lato.
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

  // Fattore di conversione scena -> spazio locale mesh, per mantenere la
  // scala percepita costante indipendentemente dalla mesh bersaglio.
  const probe = kitSizeY * 0.01;
  const p2Local = hit.clone().add(new THREE.Vector3(0, probe, 0)).applyMatrix4(inv);
  const ratio = p2Local.sub(posLocal).length() / probe;
  const s = cfg.scale * kitSizeY * ratio;
  const depth = Math.min(s * DEPTH_RATIO, kitSizeY * DEPTH_MAX_KIT * ratio);

  return {
    position: [posLocal.x, posLocal.y, posLocal.z],
    rotation: [e.x, e.y, e.z],
    scale: [s, s, depth],
  };
}

/**
 * Una trasformazione per ogni mesh del kit toccata dal riquadro di
 * proiezione: la grafica prosegue oltre le cuciture (maniche, colletto,
 * polsini, fascia in vita) invece di essere tagliata al bordo della parte
 * scelta, e resta sopra colore e pattern di ogni parte.
 */
export function computeDecalTransforms(cfg, anchor, primaryTarget, targets, kitBox) {
  if (!primaryTarget) return [];

  const kitSize = kitBox.getSize(new THREE.Vector3());
  const reach = kitSize.length();
  const { p, dir } = anchor;

  const hit = projectOntoSurface(p, dir, primaryTarget, targets, reach);
  if (!hit) return [];

  const radius = cfg.scale * kitSize.y * FOOTPRINT_RADIUS;

  return targets
    .filter((t) => t === primaryTarget || t.box.distanceToPoint(hit) <= radius)
    .map((t) => ({ target: t, ...localTransform(cfg, hit, dir, t, kitSize.y) }));
}

/**
 * Converte l'ancora (spazio scena) in posizione/rotazione/scala locali alla
 * mesh bersaglio. Ritorna null se sotto l'ancora non c'è superficie.
 */
export function computeDecalTransform(cfg, anchor, decalTarget, kitBox) {
  const list = computeDecalTransforms(cfg, anchor, decalTarget, [decalTarget], kitBox);
  return list.length > 0 ? list[0] : null;
}
