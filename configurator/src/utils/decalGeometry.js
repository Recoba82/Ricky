import * as THREE from 'three';

const FRONT = () => new THREE.Vector3(0, 0, 1);
const BACK = () => new THREE.Vector3(0, 0, -1);
const AX_X = () => new THREE.Vector3(1, 0, 0);
const AY_Y = () => new THREE.Vector3(0, 1, 0);

/**
 * Ancore di proiezione in coordinate della scena (pre-normalizzazione).
 * Ritorna sempre un array: alcune posizioni (le calze) proiettano più
 * istanze dello stesso decal. Per ogni ancora: `part` è la parte del kit su
 * cui proiettare, `p` il punto sulla superficie, `dir` la direzione di
 * proiezione, `ax`/`ay` gli assi lungo cui agiscono gli offset X/Y utente.
 *
 * Le quote relative vengono dai bounding box reali del modello: pantaloncini
 * 0.39–0.65 in altezza (gambe separate attorno a ±0.20 in X dal centro),
 * calze 0.00–0.31 (i due gambali attorno a ±0.21 in X).
 */
export function decalAnchors(position, kitBox) {
  const size = kitBox.getSize(new THREE.Vector3());
  const c = kitBox.getCenter(new THREE.Vector3());
  const atY = (rel) => kitBox.min.y + size.y * rel;

  switch (position) {
    case 'chest-left':
      return [
        { part: 'body', p: new THREE.Vector3(c.x - size.x * 0.13, atY(0.85), kitBox.max.z), dir: FRONT(), ax: AX_X(), ay: AY_Y() },
      ];
    case 'chest-right':
      return [
        { part: 'body', p: new THREE.Vector3(c.x + size.x * 0.13, atY(0.85), kitBox.max.z), dir: FRONT(), ax: AX_X(), ay: AY_Y() },
      ];
    case 'sleeve-left':
      return [
        { part: 'body', p: new THREE.Vector3(kitBox.min.x, atY(0.85), c.z), dir: new THREE.Vector3(-1, 0, 0), ax: new THREE.Vector3(0, 0, -1), ay: AY_Y() },
      ];
    case 'sleeve-right':
      return [
        { part: 'body', p: new THREE.Vector3(kitBox.max.x, atY(0.85), c.z), dir: new THREE.Vector3(1, 0, 0), ax: new THREE.Vector3(0, 0, 1), ay: AY_Y() },
      ];
    case 'back-center':
      return [
        { part: 'body', p: new THREE.Vector3(c.x, atY(0.76), kitBox.min.z), dir: BACK(), ax: new THREE.Vector3(-1, 0, 0), ay: AY_Y() },
      ];
    case 'back-shoulders':
      return [
        { part: 'body', p: new THREE.Vector3(c.x, atY(0.92), kitBox.min.z), dir: BACK(), ax: new THREE.Vector3(-1, 0, 0), ay: AY_Y() },
      ];
    case 'back-below-number':
      return [
        { part: 'body', p: new THREE.Vector3(c.x, atY(0.64), kitBox.min.z), dir: BACK(), ax: new THREE.Vector3(-1, 0, 0), ay: AY_Y() },
      ];
    case 'shorts-right-low':
      return [
        { part: 'shorts', p: new THREE.Vector3(c.x + size.x * 0.2, atY(0.45), kitBox.max.z), dir: FRONT(), ax: AX_X(), ay: AY_Y() },
      ];
    case 'shorts-left-low':
      return [
        { part: 'shorts', p: new THREE.Vector3(c.x - size.x * 0.2, atY(0.45), kitBox.max.z), dir: FRONT(), ax: AX_X(), ay: AY_Y() },
      ];
    case 'sock-front':
      // Un'istanza per gambale, sul davanti dello stinco (sopra il piede,
      // che nel modello sporge verso +Z).
      return [
        { part: 'socks', p: new THREE.Vector3(c.x - size.x * 0.21, atY(0.22), kitBox.max.z), dir: FRONT(), ax: AX_X(), ay: AY_Y() },
        { part: 'socks', p: new THREE.Vector3(c.x + size.x * 0.21, atY(0.22), kitBox.max.z), dir: FRONT(), ax: AX_X(), ay: AY_Y() },
      ];
    default:
      return [
        { part: 'body', p: new THREE.Vector3(c.x, atY(0.79), kitBox.max.z), dir: FRONT(), ax: AX_X(), ay: AY_Y() },
      ];
  }
}

/**
 * Trova il punto reale della superficie sotto l'ancora, sparando un raggio da
 * fuori il kit lungo la direzione di proiezione. Serve perché la sola quota
 * del bounding box del kit non basta: i pantaloncini rientrano rispetto al
 * petto e le calze hanno i piedi che sporgono in avanti, quindi un'ancora
 * piazzata sul fronte del kit cadrebbe nel vuoto e il decal non verrebbe
 * proiettato su nulla. Ritorna null se il raggio non incontra la mesh.
 */
function projectOntoSurface(point, dir, decalTarget, kitBox) {
  const reach = kitBox.getSize(new THREE.Vector3()).length();
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
 * mesh bersaglio, usando la matrice relativa salvata in preparazione. La
 * rotazione allinea l'asse Z del decal alla direzione di proiezione
 * (worldToLocal della direzione) e aggiunge lo spin utente attorno ad essa.
 * Ritorna null se sotto l'ancora non c'è superficie.
 */
export function computeDecalTransform(cfg, anchor0, decalTarget, kitBox) {
  const size = kitBox.getSize(new THREE.Vector3());
  const { p, dir, ax, ay } = anchor0;

  // Gli offset utente spostano il punto di mira; il raggio poi trova la
  // superficie sotto di esso, così il decal resta aderente al tessuto.
  const aim = p
    .clone()
    .addScaledVector(ax, cfg.x * size.x * 0.5)
    .addScaledVector(ay, cfg.y * size.y * 0.25);

  const anchor = projectOntoSurface(aim, dir, decalTarget, kitBox);
  if (!anchor) return null;

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
