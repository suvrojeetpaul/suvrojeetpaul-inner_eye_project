import React, { memo, useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

// Cap max rendered voxels to keep GPU frame time under budget
const MAX_VOXELS = 2400;

function MedicalMesh({
  active,
  result,
  viewMode,
  focusMode,
  performanceProfile = 'balanced',
  cameraCommand = null,
  autoSpin = false,
  cinematicTour = false,
  severityTheme = 'normal',
}) {
  const groupRef = useRef();
  const cameraRef = useRef();
  const controlsRef = useRef();
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
      return Math.max(80, Math.floor(180 * qualityScale));
    }
    return Math.max(160, Math.floor(320 * qualityScale));
  }, [dynamicQuality, qualityScale]);

  const themePalette = useMemo(() => {
    if (severityTheme === 'critical') {
      return {
        organ: '#6fb8ff',
        tumor: '#ff2f2f',
        ambient: '#ffe0e0',
        key: '#ffd3d3',
        fill: '#ffbda8',
      };
    }
    if (severityTheme === 'moderate') {
      return {
        organ: '#69bfff',
        tumor: '#ff9a2a',
        ambient: '#ffeed6',
        key: '#d6e5ff',
        fill: '#ffd2ad',
      };
    }
    return {
      organ: '#4ea8ff',
      tumor: '#ff3300',
      ambient: '#c6dcff',
      key: '#cfe0ff',
      fill: '#ffccb3',
    };
  }, [severityTheme]);

  useEffect(() => {
    if (!cameraCommand || !controlsRef.current || !cameraRef.current) return;

    const controls = controlsRef.current;
    const camera = cameraRef.current;
    const rotateStep = Math.PI / 12;

    const zoomByFactor = (factor) => {
      const offset = camera.position.clone().sub(controls.target);
      offset.multiplyScalar(factor);
      camera.position.copy(controls.target.clone().add(offset));
      controls.update();
    };

    const setPresetView = (x, y, z) => {
      camera.position.set(x, y, z);
      controls.target.set(0, 0, 0);
      controls.update();
    };

    switch (cameraCommand.type) {
      case 'zoom-in':
        zoomByFactor(0.86);
        break;
      case 'zoom-out':
        zoomByFactor(1.16);
        break;
      case 'rotate-left':
        controls.rotateLeft(rotateStep);
        controls.update();
        break;
      case 'rotate-right':
        controls.rotateLeft(-rotateStep);
        controls.update();
        break;
      case 'rotate-up':
        controls.rotateUp(rotateStep * 0.7);
        controls.update();
        break;
      case 'rotate-down':
        controls.rotateUp(-rotateStep * 0.7);
        controls.update();
        break;
      case 'reset-view':
        controls.reset();
        controls.update();
        break;
      case 'preset-front':
        setPresetView(0, 0, 6);
        break;
      case 'preset-top':
        setPresetView(0.1, 6, 0.1);
        break;
      case 'preset-side':
        setPresetView(6, 0, 0);
        break;
      case 'preset-iso':
        setPresetView(4.4, 3.4, 4.8);
        break;
      default:
        break;
    }
  }, [cameraCommand]);

  // --- [1] VOXEL CLOUD GENERATION (with decimation) ---
  const voxelData = useMemo(() => {
    if (!active || !rawVoxels || rawVoxels.length === 0) return null;

    // Decimate: if too many voxels, sample every Nth to stay within budget
    const step = rawVoxels.length > voxelBudget
      ? Math.ceil(rawVoxels.length / voxelBudget)
      : 1;
    const count = Math.ceil(rawVoxels.length / step);

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const organColor = new THREE.Color(themePalette.organ);
    const tumorColor = new THREE.Color(themePalette.tumor);

    let writeIndex = 0;
    for (let i = 0; i < rawVoxels.length; i += step) {
      const v = rawVoxels[i];
      positions[writeIndex * 3] = v[0];
      positions[writeIndex * 3 + 1] = v[1];
      positions[writeIndex * 3 + 2] = v[2];

      const baseColor = v[3] === 2 ? tumorColor : organColor;
      const shade = 0.72 + Math.random() * 0.28;
      colors[writeIndex * 3] = baseColor.r * shade;
      colors[writeIndex * 3 + 1] = baseColor.g * shade;
      colors[writeIndex * 3 + 2] = baseColor.b * shade;
      writeIndex += 1;
    }

    return { positions, colors, count: writeIndex };
  }, [active, rawVoxels, themePalette.organ, themePalette.tumor, voxelBudget]);

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

    if (autoSpin || cinematicTour) {
      groupRef.current.rotation.y += focusMode ? 0.005 : 0.0018;
    }
    if (focusMode && active && (autoSpin || cinematicTour)) {
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.08;
    }
  });

  return (
    <>
      <PerspectiveCamera ref={cameraRef} makeDefault position={[0, 0, 6]} fov={40} />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        enablePan
        autoRotate={cinematicTour}
        autoRotateSpeed={cinematicTour ? 1.35 : 0}
        zoomSpeed={0.9}
        dampingFactor={0.05}
        rotateSpeed={0.5}
        maxDistance={focusMode ? 16 : 12}
        minDistance={focusMode ? 1.5 : 2}
      />

      {/* Reduced star count – was 2400; fade removed (triggers extra shader pass) */}
      <Stars radius={80} depth={30} count={starsCount} factor={4} saturation={0} speed={0.8} />

      {/* Single directional light instead of spotLight + pointLight */}
      <ambientLight intensity={0.56} color={themePalette.ambient} />
      <directionalLight position={[10, 10, 10]} intensity={1.5} color={themePalette.key} />
      <directionalLight position={[-8, -5, 4]} intensity={0.45} color={themePalette.fill} />

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
          <group position={[result.coords.x, result.coords.y, result.coords.z]}>
            <mesh>
              <sphereGeometry args={[0.3, 16, 16]} />
              <meshStandardMaterial
                color={result.severity === 'CRITICAL' ? "#ff0000" : "#ffaa00"}
                emissive={result.severity === 'CRITICAL' ? "#ff0000" : "#ffaa00"}
                emissiveIntensity={3}
                transparent
                opacity={0.9}
              />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.52, 14, 14]} />
              <meshBasicMaterial
                color={result.severity === 'CRITICAL' ? "#ff5d5d" : "#ffcb5c"}
                transparent
                opacity={0.17}
                side={THREE.BackSide}
              />
            </mesh>
          </group>
        )}

      </group>
    </>
  );
}

export default memo(MedicalMesh);