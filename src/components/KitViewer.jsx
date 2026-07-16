import React, { Suspense, forwardRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Bounds, Html } from '@react-three/drei';
import StudioEnvironment from './StudioEnvironment';
import RealisticKit from './RealisticKit';

function Loader() {
  return <Html center className="loader">Caricamento modello 3D…</Html>;
}

const KitViewer = forwardRef(function KitViewer({ config }, canvasRef) {
  return (
    <Canvas
      shadows="soft"
      camera={{ position: [0, 0.2, 3.5], fov: 35 }}
      gl={{ preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        if (canvasRef) canvasRef.current = gl.domElement;
      }}
    >
      <color attach="background" args={['#11151c']} />
      <StudioEnvironment />
      <hemisphereLight args={['#dfe8ff', '#0b0e14', 0.55]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 4]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-3, 2, -3]} intensity={0.5} />

      <Suspense fallback={<Loader />}>
        <Bounds fit clip observe margin={1.3}>
          <RealisticKit
            pattern={config.pattern}
            primary={config.primaryColor}
            secondary={config.secondaryColor}
            decals={{
              sponsorText: config.sponsorText,
              sponsorColor: config.sponsorColor,
              sponsorImage: config.sponsorImage,
              backName: config.backName,
              backNumber: config.backNumber,
              numberColor: config.numberColor,
            }}
          />
        </Bounds>
      </Suspense>

      <ContactShadows position={[0, -1.05, 0]} opacity={0.55} scale={6} blur={2.5} far={2.5} />
      <OrbitControls makeDefault enablePan={false} minDistance={0.8} maxDistance={12} />
    </Canvas>
  );
});

export default KitViewer;
