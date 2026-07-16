import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Generates a synthetic studio light-room reflection environment locally
 * (no network HDRI fetch) so fabric materials pick up soft, realistic
 * highlights instead of looking flat.
 */
export default function StudioEnvironment() {
  const { gl, scene } = useThree();

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const renderTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = renderTarget.texture;
    return () => {
      renderTarget.dispose();
      pmrem.dispose();
      scene.environment = null;
    };
  }, [gl, scene]);

  return null;
}
