import React, { Suspense, useEffect } from 'react';
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
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0.4, 4.6], fov: 35 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#eef0f4']} />

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

      <ContactShadows position={[0, -1.28, 0]} opacity={0.45} scale={7} blur={2.4} far={2.6} />

      <OrbitControls
        makeDefault
        enablePan={false}
        target={[0, 0, 0]}
        minDistance={2.2}
        maxDistance={8}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 1.9}
      />
    </Canvas>
  );
}
