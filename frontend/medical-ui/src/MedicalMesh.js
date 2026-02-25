import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Float, ContactShadows, Torus, Environment } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Tactical Anomaly Component:
 * This is the "Tumour Structure" you need for studying.
 * It remains visible inside the neural shell.
 */
function ClinicalAnomaly({ active, result }) {
  const anomalyRef = useRef();

  useFrame((state) => {
    if (anomalyRef.current && active) {
      const t = state.clock.getElapsedTime();
      // Intense biological pulsing for study
      const s = 1 + Math.sin(t * 4) * 0.12;
      anomalyRef.current.scale.set(s, s, s);
    }
  });

  if (!active) return null;

  return (
    <group position={[
      result?.coords?.x || 0.4, 
      result?.coords?.y || -0.1, 
      result?.coords?.z || 0.3
    ]}>
      <mesh ref={anomalyRef}>
        <sphereGeometry args={[0.65, 64, 64]} />
        <meshStandardMaterial 
          color="#ff4400" 
          emissive="#ffcc33" 
          emissiveIntensity={25} 
          roughness={0}
          metalness={1}
        />
      </mesh>
      {/* Internal point light to illuminate the wireframe from within */}
      <pointLight color="#ff4400" intensity={15} distance={6} decay={2} />
    </group>
  );
}

/**
 * Main Medical Mesh:
 * Keeps your blue wireframe but adds the internal tumour structure.
 */
export default function MedicalMesh({ active, result }) {
  const shellRef = useRef();
  // Match the theme color to your current blue wireframe
  const themeColor = "#4ea8ff"; 

  useFrame((state) => {
    if (shellRef.current) {
      shellRef.current.rotation.y += 0.003;
    }
  });

  return (
    <div style={{ width: '100%', height: '100%', background: '#000' }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 42 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={2} />
        
        <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.4}>
          <group>
            {/* THE NEURAL STRUCTURE (The Shell) */}
            <mesh ref={shellRef}>
              <sphereGeometry args={[1.5, 48, 48]} />
              <meshPhongMaterial
                color={themeColor}
                wireframe
                transparent
                opacity={0.3}
              />
            </mesh>

            {/* THE TUMOUR STRUCTURE (The Core) */}
            <ClinicalAnomaly active={active} result={result} />
          </group>
        </Float>

        <Environment preset="night" />
        <OrbitControls enablePan={false} minDistance={3} maxDistance={8} />
        <ContactShadows position={[0, -2.2, 0]} opacity={0.4} scale={10} blur={2.5} />
      </Canvas>
    </div>
  );
}