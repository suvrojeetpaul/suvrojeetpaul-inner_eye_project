import React, { memo, useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

// Cap max rendered voxels to keep GPU frame time under budget
const MAX_VOXELS = 3000;

function MedicalMesh({ active, result, viewMode, focusMode, performanceProfile = 'balanced' }) {
  const groupRef = useRef();
  const rawVoxels = result?.voxels;
  const [dynamicQuality, setDynamicQuality] = useState('normal');
  const fpsProbeRef = useRef({ frameCount: 0, deltaSum: 0 });

  const qualityScale = useMemo(() => {
    if (performanceProfile === 'eco') return 0.6;
    if (performanceProfile === 'performance') return 0.8;
    return 1;
  }, [performanceProfile]);

  const voxelBudget = useMemo(() => {
    if (dynamicQuality === 'low') {
      return Math.max(900, Math.floor(MAX_VOXELS * 0.5 * qualityScale));
    }
    return Math.max(1400, Math.floor(MAX_VOXELS * qualityScale));
  }, [dynamicQuality, qualityScale]);

  const starsCount = useMemo(() => {
    if (dynamicQuality === 'low') {
      return Math.max(120, Math.floor(260 * qualityScale));
    }
    return Math.max(260, Math.floor(520 * qualityScale));
  }, [dynamicQuality, qualityScale]);

  // --- [1] VOXEL CLOUD GENERATION (with decimation) ---
  const voxelData = useMemo(() => {
    if (!active || !rawVoxels || rawVoxels.length === 0) return null;

    // Decimate: if too many voxels, sample every Nth to stay within budget
    const step = rawVoxels.length > voxelBudget
      ? Math.ceil(rawVoxels.length / voxelBudget)
      : 1;
    const sampled = step > 1 ? rawVoxels.filter((_, i) => i % step === 0) : rawVoxels;
    const count = sampled.length;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const organColor = new THREE.Color("#4ea8ff");
    const tumorColor = new THREE.Color("#ff3300");

    for (let i = 0; i < count; i++) {
      const v = sampled[i];
      positions[i * 3]     = v[0];
      positions[i * 3 + 1] = v[1];
      positions[i * 3 + 2] = v[2];

      const baseColor = v[3] === 2 ? tumorColor : organColor;
      const shade = 0.72 + Math.random() * 0.28;
      colors[i * 3]     = baseColor.r * shade;
      colors[i * 3 + 1] = baseColor.g * shade;
      colors[i * 3 + 2] = baseColor.b * shade;
    }

    return { positions, colors, count };
  }, [active, rawVoxels, voxelBudget]);

  // --- [2] MINIMAL ANIMATION LOOP ---
  // Only rotate; skip expensive scale.set() / Math.sin per frame
  useFrame((state) => {
    if (!groupRef.current) return;

    // Update quality every ~2 seconds based on measured FPS.
    fpsProbeRef.current.frameCount += 1;
    fpsProbeRef.current.deltaSum += state.clock.getDelta();
    if (fpsProbeRef.current.frameCount >= 120) {
      const avgDelta = fpsProbeRef.current.deltaSum / fpsProbeRef.current.frameCount;
      const approxFps = avgDelta > 0 ? 1 / avgDelta : 60;
      const nextQuality = approxFps < 28 ? 'low' : 'normal';
      if (nextQuality !== dynamicQuality) {
        setDynamicQuality(nextQuality);
      }
      fpsProbeRef.current.frameCount = 0;
      fpsProbeRef.current.deltaSum = 0;
    }

    groupRef.current.rotation.y += focusMode ? 0.005 : 0.0018;
    if (focusMode && active) {
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.08;
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 6]} fov={40} />
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.5}
        maxDistance={focusMode ? 16 : 12}
        minDistance={focusMode ? 1.5 : 2}
      />

      {/* Reduced star count – was 2400; fade removed (triggers extra shader pass) */}
      <Stars radius={80} depth={30} count={starsCount} factor={4} saturation={0} speed={0.8} />

      {/* Single directional light instead of spotLight + pointLight */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={1.6} />

      <group ref={groupRef}>

        {/* Ghost anatomical shell – segments dropped 64→24 (4096→576 verts) */}
        <mesh>
          <sphereGeometry args={[2.1, 24, 24]} />
          <meshPhongMaterial
            color="#111"
            transparent
            opacity={viewMode === "WIRE" ? 0.2 : 0.05}
            wireframe={viewMode === "WIRE"}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Voxel point cloud – AdditiveBlending removed (expensive on large clouds) */}
        {voxelData && (
          <points>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={voxelData.count}
                array={voxelData.positions}
                itemSize={3}
              />
              <bufferAttribute
                attach="attributes-color"
                count={voxelData.count}
                array={voxelData.colors}
                itemSize={3}
              />
            </bufferGeometry>
            <pointsMaterial
              size={0.05}
              vertexColors
              transparent
              opacity={0.88}
              sizeAttenuation
              depthWrite={false}
            />
          </points>
        )}

        {/* Tumor marker – Float & inline pointLight removed (per-frame physics + dynamic light) */}
        {active && result?.coords && (
          <mesh position={[result.coords.x, result.coords.y, result.coords.z]}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial
              color={result.severity === 'CRITICAL' ? "#ff0000" : "#ffaa00"}
              emissive={result.severity === 'CRITICAL' ? "#ff0000" : "#ffaa00"}
              emissiveIntensity={3}
              transparent
              opacity={0.9}
            />
          </mesh>
        )}

      </group>
    </>
  );
}

export default memo(MedicalMesh);