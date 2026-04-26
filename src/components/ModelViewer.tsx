"use client";

import { Canvas } from "@react-three/fiber";
import { useGLTF, OrbitControls, Center, Environment } from "@react-three/drei";
import { Suspense, useEffect } from "react";

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  useEffect(() => {
    return () => useGLTF.clear(url);
  }, [url]);
  return (
    <Center>
      <primitive object={scene} />
    </Center>
  );
}

function Spinner() {
  return (
    <mesh>
      <sphereGeometry args={[0.3, 8, 8]} />
      <meshBasicMaterial color="#6366f1" wireframe />
    </mesh>
  );
}

interface ModelViewerProps {
  src: string;
  className?: string;
  autoRotate?: boolean;
  rotateSpeed?: number;
}

export function ModelViewer({ src, className, autoRotate = true, rotateSpeed = 1.5 }: ModelViewerProps) {
  return (
    <Canvas
      camera={{ position: [0, 1.5, 4], fov: 45 }}
      className={className}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
      <directionalLight position={[-5, -3, -5]} intensity={0.4} color="#8b5cf6" />
      <pointLight position={[0, -4, 0]} intensity={0.3} color="#1d4ed8" />
      <Suspense fallback={<Spinner />}>
        <Model url={src} />
        <Environment preset="night" />
      </Suspense>
      <OrbitControls
        autoRotate={autoRotate}
        autoRotateSpeed={rotateSpeed}
        enableZoom
        minDistance={1}
        maxDistance={12}
        enablePan={false}
      />
    </Canvas>
  );
}
