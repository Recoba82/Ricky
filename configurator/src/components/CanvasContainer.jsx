import React, { Suspense, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Html } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import ShirtModel from './ShirtModel';

/**
 * Ambiente studio generato localmente (nessun fetch di HDRI esterne): dà ai
 * materiali PBR riflessi morbidi e realistici.
 */
function StudioEnvironment() {
  const { gl, scene } = useThree();

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = rt.texture;
    return () => {
      rt.dispose();
      pmrem.dispose();
      scene.environment = null;
    };
  }, [gl, scene]);

  return null;
}

/**
 * Inquadratura adattiva: calcola la distanza della camera in base al rapporto
 * di forma del canvas, cosi il kit resta interamente visibile anche su
 * schermi molto stretti (mobile a 318px) o su canvas bassi.
 */
function ResponsiveCamera() {
  const { camera, size } = useThree();
  const applied = useRef(0);

  useEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const halfV = Math.tan((camera.fov * Math.PI) / 360);
    const distV = 1.45 / halfV;
    const distH = 0.85 / (halfV * Math.max(aspect, 0.2));
    const dist = Math.min(Math.max(distV, distH), 7.6);
    if (Math.abs(applied.current - dist) < 0.02) return;
    applied.current = dist;
    const factor = dist / 4.6;
    camera.position.set(0, 0.4 * factor, 4.6 * factor);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  return null;
}

function Loader() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-indigo-500" />
        <p className="whitespace-nowrap text-sm text-slate-500">Caricamento modello 3D…</p>
      </div>
    </Html>
  );
}

export default function CanvasContainer() {
  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      camera={{ position: [0, 0.4, 4.6], fov: 35 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#eef0f4']} />

      <ResponsiveCamera />

      <hemisphereLight args={['#ffffff', '#b7bdc9', 0.5]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        castShadow
        position={[4, 6, 4]}
        intensity={1.5}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-4, 2.5, -4]} intensity={0.55} />

      <Suspense fallback={<Loader />}>
        <StudioEnvironment />
        <ShirtModel />
      </Suspense>

      {/* Ombra di contatto morbida e leggera sotto il kit */}
      <ContactShadows
        position={[0, -1.29, 0]}
        opacity={0.32}
        scale={8}
        blur={3.2}
        far={3}
        resolution={1024}
        color="#1e293b"
      />

      {/*
        Trascinamento del modello sullo schermo: tenendo premuto il tasto destro
        del mouse il kit intero si sposta liberamente, sia in orizzontale sia in
        verticale (pan nel piano dello schermo). Il tasto sinistro continua a
        ruotare la vista, la rotellina a zoomare.
      */}
      <OrbitControls
        makeDefault
        enablePan
        screenSpacePanning
        panSpeed={1}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        target={[0, 0, 0]}
        minDistance={2.2}
        maxDistance={8}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 1.9}
      />
    </Canvas>
  );
}
