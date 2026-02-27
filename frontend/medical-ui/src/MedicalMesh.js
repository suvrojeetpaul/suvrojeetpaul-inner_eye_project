import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, PerspectiveCamera, Float } from '@react-three/drei';
import * as THREE from 'three';

/**
 * MEDICAL_MESH // MULTI-CLASS VOXEL RECONSTRUCTION
 * Hand-coded BufferAttribute mapping for Organ vs Tumor rendering
 */
export default function MedicalMesh({ active, result, viewMode }) {
  const groupRef = useRef();
  const pointsRef = useRef();
  const { clock } = useThree();

  // --- [1] VOXEL CLOUD GENERATION ---
  const voxelData = useMemo(() => {
    if (!active || !result || !result.voxels) return null;

    const rawVoxels = result.voxels; 
    const count = rawVoxels.length;
    
    // Arrays for GPU BufferAttributes
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    const organColor = new THREE.Color("#4ea8ff"); // Clinical Blue
    const tumorColor = new THREE.Color("#ff3300"); // Critical Red

    rawVoxels.forEach((v, i) => {
      // Coordinates from Backend (X, Y, Z, Label)
      positions[i * 3] = v[0];
      positions[i * 3 + 1] = v[1];
      positions[i * 3 + 2] = v[2];

      // Label-based Coloring (v[3] is the label: 1=Organ, 2=Tumor)
      const label = v[3];
      const baseColor = label === 2 ? tumorColor : organColor;
      
      // Clinical shading: Add random variance to simulate tissue heterogeneity
      const shade = 0.7 + (Math.random() * 0.3);
      colors[i * 3] = baseColor.r * shade;
      colors[i * 3 + 1] = baseColor.g * shade;
      colors[i * 3 + 2] = baseColor.b * shade;

      // Sizes: Tumors voxels rendered slightly larger for visibility
      sizes[i] = label === 2 ? 0.08 : 0.04;
    });

    return { positions, colors, sizes };
  }, [active, result]);

  // --- [2] ANIMATION & PHYSICS ENGINE ---
  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    if (groupRef.current) {
      // Slow rotation for inspection
      groupRef.current.rotation.y += 0.002;
      
      // Dynamic scaling (Heartbeat pulse)
      if (active) {
        const pulse = 1 + Math.sin(t * 1.5) * 0.015;
        groupRef.current.scale.set(pulse, pulse, pulse);
      }
    }

    // Sub-voxel drift animation
    if (pointsRef.current && active) {
        pointsRef.current.rotation.z = Math.sin(t * 0.3) * 0.03;
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 6]} fov={40} />
      <OrbitControls 
        enableDamping 
        dampingFactor={0.05} 
        rotateSpeed={0.5} 
        maxDistance={12} 
        minDistance={2} 
      />
      
      <Stars radius={100} depth={50} count={6000} factor={4} saturation={0} fade speed={1.5} />
      
      {/* Clinical Lighting Setup */}
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={1.5} color="#ffffff" />
      <spotLight position={[-10, 10, 10]} angle={0.15} penumbra={1} intensity={1} />

      <group ref={groupRef}>
        
        {/* EXTERNAL ANATOMICAL SHELL (Preserved Ghost Shell) */}
        <mesh>
          <sphereGeometry args={[2.1, 64, 64]} />
          <meshPhongMaterial 
            color="#111" 
            transparent 
            opacity={viewMode === "WIRE" ? 0.2 : 0.05} 
            wireframe={viewMode === "WIRE"} 
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* 3D VOXEL RECONSTRUCTION LAYER */}
        {voxelData && (
          <points ref={pointsRef}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={voxelData.positions.length / 3}
                array={voxelData.positions}
                itemSize={3}
              />
              <bufferAttribute
                attach="attributes-color"
                count={voxelData.colors.length / 3}
                array={voxelData.colors}
                itemSize={3}
              />
            </bufferGeometry>
            <pointsMaterial 
              size={0.045} 
              vertexColors 
              transparent 
              opacity={0.85} 
              sizeAttenuation={true} 
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </points>
        )}

        {/* CLINICAL ANOMALY MARKER (Preserved Feature) */}
        {active && result?.coords && (
          <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
            <mesh position={[result.coords.x, result.coords.y, result.coords.z]}>
              <sphereGeometry args={[0.3, 32, 32]} />
              <meshStandardMaterial 
                color={result.severity === 'CRITICAL' ? "#ff0000" : "#ffaa00"} 
                emissive={result.severity === 'CRITICAL' ? "#ff0000" : "#ffaa00"}
                emissiveIntensity={4}
                transparent
                opacity={0.9}
              />
              <pointLight color="red" intensity={5} distance={3} />
            </mesh>
          </Float>
        )}
      </group>
    </>
  );
}