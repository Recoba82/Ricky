import * as THREE from 'three';

/**
 * Profilo reale dello scollo, campionato dalla mesh del colletto scansionato
 * (Object_2 del GLB) ogni 10°: raggio interno/esterno e relativa quota Y,
 * intorno al centro CENTER, nello stesso spazio locale in cui vive `root` in
 * ShirtModel (prima della normalizzazione scala/posizione del gruppo
 * esterno). Serve per generare le varianti "Polo" e "Collo a V": il modello
 * e' una scansione statica con un solo colletto, quindi le altre forme sono
 * fasce procedurali che seguono il bordo reale dello scollo invece di un
 * cerchio approssimato.
 *
 * Colonne: [angoloDeg, raggioInterno, quotaInterna, raggioEsterno, quotaEsterna]
 * angolo 0 = +X (fianco), 90 = +Z (fronte), -90 = -Z (retro), ±180 = -X (fianco).
 */
const CENTER = { x: -0.00067, z: -0.05746 };

const TABLE = [
  [-180, 0.06672, 1.67744, 0.08704, 1.65613],
  [-170, 0.06514, 1.68299, 0.08728, 1.65876],
  [-160, 0.0624, 1.68692, 0.08656, 1.66451],
  [-150, 0.0595, 1.68986, 0.08331, 1.66762],
  [-140, 0.05813, 1.69073, 0.07774, 1.66853],
  [-130, 0.05502, 1.69181, 0.07354, 1.66826],
  [-120, 0.05207, 1.69208, 0.06765, 1.66767],
  [-110, 0.05095, 1.69217, 0.0648, 1.66752],
  [-100, 0.05021, 1.69216, 0.06327, 1.66754],
  [-90, 0.05, 1.69214, 0.06337, 1.66756],
  [-80, 0.05111, 1.69217, 0.06496, 1.6676],
  [-70, 0.05225, 1.69219, 0.06784, 1.66784],
  [-60, 0.05538, 1.69208, 0.07171, 1.66829],
  [-50, 0.05846, 1.69001, 0.07802, 1.66876],
  [-40, 0.06005, 1.69026, 0.08362, 1.66775],
  [-30, 0.06299, 1.68748, 0.08674, 1.66463],
  [-20, 0.06577, 1.68361, 0.08739, 1.66131],
  [-10, 0.0673, 1.67824, 0.0869, 1.65614],
  [0, 0.06775, 1.66778, 0.08591, 1.64656],
  [10, 0.06788, 1.6559, 0.08447, 1.63629],
  [20, 0.06569, 1.6448, 0.08213, 1.62602],
  [30, 0.06398, 1.63264, 0.0786, 1.617],
  [40, 0.06268, 1.62715, 0.0752, 1.60979],
  [50, 0.06115, 1.61473, 0.07114, 1.60321],
  [60, 0.05935, 1.61572, 0.068, 1.59971],
  [70, 0.05713, 1.61468, 0.06464, 1.59714],
  [80, 0.05638, 1.61245, 0.06326, 1.59623],
  [90, 0.05634, 1.61245, 0.06314, 1.59625],
  [100, 0.05698, 1.61411, 0.06542, 1.5979],
  [110, 0.05899, 1.61794, 0.06771, 1.59979],
  [120, 0.06053, 1.61658, 0.07181, 1.60457],
  [130, 0.06269, 1.62254, 0.07478, 1.6096],
  [140, 0.06365, 1.63793, 0.07813, 1.61704],
  [150, 0.06514, 1.64445, 0.08154, 1.62592],
  [160, 0.0673, 1.65898, 0.08396, 1.63587],
  [170, 0.06712, 1.66268, 0.08582, 1.64635],
];

const STEP = 360 / TABLE.length;

function wrapAngle(deg) {
  return (((deg + 180) % 360) + 360) % 360 - 180;
}

function sampleAt(angleDeg) {
  const a = wrapAngle(angleDeg);
  const n = TABLE.length;
  let idx = Math.floor((a + 180) / STEP);
  idx = ((idx % n) + n) % n;
  const idxNext = (idx + 1) % n;
  const row0 = TABLE[idx];
  const row1 = TABLE[idxNext];
  let t = (a - row0[0]) / STEP;
  if (t < 0) t += 1;
  const lerp = (u, v) => u + (v - u) * t;
  return {
    innerR: lerp(row0[1], row1[1]),
    innerY: lerp(row0[2], row1[2]),
    outerR: lerp(row0[3], row1[3]),
    outerY: lerp(row0[4], row1[4]),
  };
}

/** Punto 3D sul bordo dello scollo (interno o esterno) con offset radiale opzionale. */
export function necklinePoint(angleDeg, kind = 'inner', radiusOffset = 0) {
  const s = sampleAt(angleDeg);
  const r = (kind === 'inner' ? s.innerR : s.outerR) + radiusOffset;
  const y = kind === 'inner' ? s.innerY : s.outerY;
  const rad = (angleDeg * Math.PI) / 180;
  return new THREE.Vector3(CENTER.x + r * Math.cos(rad), y, CENTER.z + r * Math.sin(rad));
}

/**
 * Fascia (ring band) che segue il profilo reale dello scollo tra due angoli
 * (in gradi, puo' superare ±180 per attraversare il retro in un unico giro).
 * `riseY` solleva la fascia di poco per evitare z-fighting con la maglia
 * sottostante.
 */
export function buildRingBand({
  angleFrom,
  angleTo,
  segments = 72,
  innerOffset = 0.004,
  outerOffset = 0.02,
  riseY = 0.006,
}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const span = angleTo - angleFrom;

  for (let i = 0; i <= segments; i++) {
    const ang = angleFrom + (span * i) / segments;
    const pIn = necklinePoint(ang, 'inner', innerOffset);
    const pOut = necklinePoint(ang, 'outer', outerOffset);
    positions.push(pIn.x, pIn.y + riseY, pIn.z, pOut.x, pOut.y + riseY, pOut.z);
    // u = posizione lungo la circonferenza, v = 0 interno / 1 esterno: con la
    // normal map a coste (variazione lungo la sua U, costante lungo la V) le
    // creste corrono verticali (interno->esterno), ripetute intorno al collo
    // via texture.repeat sulla U, cosi' come un vero colletto a costine.
    const u = i / segments;
    uvs.push(u, 0, u, 1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Nastro piatto tra due punti 3D (placket della polo, bordi del collo a V):
 * un quad suddiviso, spostato lungo `offset` per staccarsi dalla superficie
 * sottostante ed evitare z-fighting.
 */
export function buildStraightRibbon(pA, pB, width = 0.018, offset = new THREE.Vector3(0, 0, 0.014), segments = 8) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const dir = pB.clone().sub(pA);
  let side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
  side.normalize().multiplyScalar(width / 2);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const c = pA.clone().lerp(pB, t).add(offset);
    positions.push(c.x - side.x, c.y - side.y, c.z - side.z, c.x + side.x, c.y + side.y, c.z + side.z);
    uvs.push(0, t, 1, t);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Falda piatta del colletto Polo: dal bordo della fascia (collar stand)
 * all'altezza spalla si allarga verso il petto e si assottiglia fino alla
 * punta vicino al primo bottone, replicando la sagoma ripiegata di un vero
 * colletto polo (a differenza della fascia, che e' solo lo stacco verticale
 * intorno al collo). Quad a ventaglio di 4 punti: attacco interno, attacco
 * esterno (sulla fascia), "pancia" della falda spinta verso il petto, punta.
 */
export function buildCollarLapel({
  shoulderAngle,
  apex,
  bandInnerOffset = 0.004,
  bandOuterOffset = 0.012,
  bulgeOffset = 0.05,
  bulgeAngleShift = 22,
  dropY = 0.035,
  forwardZ = 0.013,
  riseY = 0.007,
}) {
  const lift = new THREE.Vector3(0, riseY, 0);
  const towardFront = Math.sign(90 - shoulderAngle) || 1;
  const bulgeAngle = shoulderAngle + towardFront * bulgeAngleShift;

  const pIn = necklinePoint(shoulderAngle, 'inner', bandInnerOffset).add(lift);
  const pOut = necklinePoint(shoulderAngle, 'outer', bandOuterOffset).add(lift);
  const pBulge = necklinePoint(bulgeAngle, 'outer', bulgeOffset)
    .add(new THREE.Vector3(0, -dropY * 0.4, forwardZ * 0.6))
    .add(lift);
  const pTip = apex.clone().add(new THREE.Vector3(0, -dropY, forwardZ)).add(lift);

  const positions = [
    pIn.x, pIn.y, pIn.z,
    pOut.x, pOut.y, pOut.z,
    pBulge.x, pBulge.y, pBulge.z,
    pTip.x, pTip.y, pTip.z,
  ];
  // u = attacco (0 = lato collo, 1 = bordo esterno/pancia) per far correre le
  // coste della normal map dal collo verso la punta; v = percorso interno
  // (0 in alto in fascia) -> punta (1), cosi' la trama non si strizza.
  const uvs = [0, 0, 1, 0, 1, 0.62, 0.5, 1];
  const indices = [0, 1, 2, 0, 2, 3];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
