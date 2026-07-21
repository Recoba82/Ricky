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

/**
 * Trova il punto reale della superficie sotto il punto di mira, sparando un
 * raggio da fuori il kit lungo la direzione di proiezione. Serve perché la
 * sola quota del riquadro non basta: i pantaloncini rientrano rispetto al
 * petto e le calze hanno i piedi che sporgono in avanti, quindi un punto
 * ricavato dal riquadro cadrebbe nel vuoto e non verrebbe proiettato nulla.
 * Ritorna null se il raggio non incontra la mesh.
 */
function projectOntoSurface(point, dir, decalTarget, reach) {
  const origin = point.clone().addScaledVector(dir, reach);

  const probe = new THREE.Mesh(decalTarget.mesh.geometry);
  decalTarget.matrixRel.decompose(probe.position, probe.quaternion, probe.scale);
  probe.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(origin, dir.clone().negate(), 0, reach * 2);
  const hits = raycaster.intersectObject(probe, false);
  return hits.length > 0 ? hits[0].point.clone() : null;
}

/**
 * Converte l'ancora (spazio scena) in posizione/rotazione/scala locali alla
 * mesh bersaglio. Ritorna null se sotto l'ancora non c'è superficie.
 */
export function computeDecalTransform(cfg, anchor, decalTarget, kitBox) {
  const size = kitBox.getSize(new THREE.Vector3());
  const reach = size.length();
  const { p, dir } = anchor;

  const hit = projectOntoSurface(p, dir, decalTarget, reach);
  if (!hit) return null;

  const inv = decalTarget.matrixRel.clone().invert();
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
  const probe = size.y * 0.01;
  const p2Local = hit.clone().add(new THREE.Vector3(0, probe, 0)).applyMatrix4(inv);
  const ratio = p2Local.sub(posLocal).length() / probe;
  const s = cfg.scale * size.y * ratio;

  return {
    position: [posLocal.x, posLocal.y, posLocal.z],
    rotation: [e.x, e.y, e.z],
    scale: [s, s, s * 0.3],
  };
}
