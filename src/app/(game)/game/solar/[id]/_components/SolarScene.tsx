"use client";

/**
 * SolarScene — interactive 3D solar system view.
 *
 * Features:
 *   - Blender GLB planet models per planet type (auto-scaled, auto-centered)
 *   - Procedural sphere fallback when a model isn't available
 *   - Click on a planet  → fires onPlanetClick(index)
 *   - Pointer-drag from one planet to another → fires onSupplyDrop(toIndex)
 *   - Clickable station marker → fires onStationClick()
 *   - Clickable ship markers  → fires onShipClick(shipId)
 *   - Visual feedback: selection ring, supply-source ring, drop-target ring, drag line
 *   - OrbitControls (constrained zoom, no pan)
 */

import { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Stars, OrbitControls, Line, useGLTF } from "@react-three/drei";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Model paths (public/assets/planets/)
// ---------------------------------------------------------------------------

const MODEL_PATH: Partial<Record<string, string>> = {
  lush:       "/assets/planets/Lush%20Planet.glb",
  habitable:  "/assets/planets/Lush%20Planet.glb",
  ocean:      "/assets/planets/Ocean%20Planet.glb",
  desert:     "/assets/planets/Desert%20Planet.glb",
  ice_planet: "/assets/planets/Ice%20Planet.glb",
  frozen:     "/assets/planets/Ice%20Planet.glb",
  volcanic:   "/assets/planets/Lava%20Planet.glb",
  toxic:      "/assets/planets/Toxic%20Planet.glb",
  barren:     "/assets/planets/Barren%20Planet.glb",
  rocky:      "/assets/planets/Barren%20Planet.glb",
  gas_giant:  "/assets/planets/Gas%20Planet.glb",
  ice_giant:  "/assets/planets/Ice%20Gas%20Giant%20Planet.glb",
};

// Preload all unique model paths (filter out undefined from Partial values)
const uniquePaths = [...new Set(Object.values(MODEL_PATH).filter((p): p is string => p !== undefined))];
uniquePaths.forEach((p) => useGLTF.preload(p));

// ---------------------------------------------------------------------------
// Colour / sizing tables
// ---------------------------------------------------------------------------

const STAR_COLOR: Record<string, string> = {
  O: "#93c5fd", B: "#93c5fd", A: "#bfdbfe",
  F: "#fef3c7", G: "#fde68a", K: "#fdba74", M: "#fca5a5",
};
const STAR_EMISSIVE: Record<string, string> = {
  O: "#3b82f6", B: "#3b82f6", A: "#60a5fa",
  F: "#fbbf24", G: "#f59e0b", K: "#f97316", M: "#ef4444",
};
const STAR_RADIUS: Record<string, number> = {
  O: 1.40, B: 1.20, A: 1.00, F: 0.90, G: 0.80, K: 0.70, M: 0.55,
};

const PLANET_COLOR: Record<string, string> = {
  lush: "#4ade80", habitable: "#86efac", ocean: "#38bdf8",
  rocky: "#a8a29e", barren: "#78716c", desert: "#fbbf24",
  frozen: "#bae6fd", ice_planet: "#7dd3fc", ice_giant: "#67e8f9",
  gas_giant: "#fb923c", volcanic: "#f87171", toxic: "#a3e635",
  asteroid_belt: "#6b7280",
};
const PLANET_ROUGHNESS: Record<string, number> = {
  gas_giant: 0.15, ice_giant: 0.15, volcanic: 0.45,
  ocean: 0.30, lush: 0.65, frozen: 0.50,
};

function planetRadius(size: string, type: string): number {
  if (type === "gas_giant" || type === "ice_giant") {
    return ({ tiny: 0.28, small: 0.34, medium: 0.42, large: 0.52, huge: 0.64 } as Record<string, number>)[size] ?? 0.38;
  }
  return ({ tiny: 0.12, small: 0.16, medium: 0.22, large: 0.28, huge: 0.34 } as Record<string, number>)[size] ?? 0.18;
}

function bodyDisplayLabel(type: string): string {
  return ({
    lush: "Lush", habitable: "Habitable", ocean: "Ocean", rocky: "Rocky",
    barren: "Barren", desert: "Desert", frozen: "Frozen", ice_planet: "Ice Planet",
    ice_giant: "Ice Giant", gas_giant: "Gas Giant", volcanic: "Volcanic",
    toxic: "Toxic", asteroid_belt: "Belt",
  } as Record<string, string>)[type] ?? type;
}

// ---------------------------------------------------------------------------
// GLB planet model component
// ---------------------------------------------------------------------------

function PlanetModel({ path, radius }: { path: string; radius: number }) {
  const { scene } = useGLTF(path);

  // Clone scene so each planet instance is independent; also clone materials
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => (m as THREE.Material).clone());
        } else {
          mesh.material = (mesh.material as THREE.Material).clone();
        }
      }
    });
    return c;
  }, [scene]);

  // Auto-scale so bounding sphere matches target radius
  const scale = useMemo(() => {
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    // Re-center to origin in case the model is off-centre
    const center = new THREE.Vector3();
    box.getCenter(center);
    cloned.position.sub(center);
    return maxDim > 0 ? (radius * 2) / maxDim : 1;
  }, [cloned, radius]);

  return <primitive object={cloned} scale={scale} />;
}

// ---------------------------------------------------------------------------
// Procedural planet body (fallback)
// ---------------------------------------------------------------------------

function ProceduralPlanet({ bodyType, radius }: { bodyType: string; radius: number }) {
  return (
    <mesh>
      <sphereGeometry args={[radius, 36, 24]} />
      <meshStandardMaterial
        color={PLANET_COLOR[bodyType] ?? "#9ca3af"}
        roughness={PLANET_ROUGHNESS[bodyType] ?? 0.78}
        metalness={bodyType === "volcanic" ? 0.25 : 0.02}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Star
// ---------------------------------------------------------------------------

function Star({ spectralClass }: { spectralClass: string }) {
  const r = STAR_RADIUS[spectralClass] ?? 0.80;
  const color  = STAR_COLOR[spectralClass]    ?? "#fde68a";
  const emissv = STAR_EMISSIVE[spectralClass] ?? "#b45309";
  return (
    <group>
      <mesh renderOrder={-2}>
        <sphereGeometry args={[r * 3.8, 16, 16]} />
        <meshBasicMaterial color={emissv} transparent opacity={0.04} depthWrite={false} side={THREE.BackSide} />
      </mesh>
      <mesh renderOrder={-1}>
        <sphereGeometry args={[r * 2.2, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.09} depthWrite={false} side={THREE.BackSide} />
      </mesh>
      <mesh>
        <sphereGeometry args={[r, 64, 32]} />
        <meshStandardMaterial color={color} emissive={emissv} emissiveIntensity={2.2} roughness={0.45} metalness={0.00} />
      </mesh>
      <pointLight color={color} intensity={5} distance={28} decay={1.8} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Orbital ring
// ---------------------------------------------------------------------------

function OrbitalRing({ radius, dashed = false }: { radius: number; dashed?: boolean }) {
  const pts = useMemo(() => {
    const N = dashed ? 96 : 160;
    return Array.from({ length: N + 1 }, (_, i) => {
      const a = (i / N) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    });
  }, [radius, dashed]);
  return (
    <Line points={pts} color={dashed ? "#374151" : "#1f2937"} lineWidth={0.6} transparent opacity={dashed ? 0.4 : 0.55} />
  );
}

// ---------------------------------------------------------------------------
// Asteroid belt
// ---------------------------------------------------------------------------

function AsteroidBelt({ orbitRadius, period, index }: { orbitRadius: number; period: number; index: number }) {
  const groupRef = useRef<THREE.Group>(null!);
  const rocks = useMemo(() => Array.from({ length: 30 }, (_, i) => {
    const a = (i / 30) * Math.PI * 2;
    const r = orbitRadius * (0.97 + (Math.sin(i * 7.31) * 0.5 + 0.5) * 0.06);
    const y = (Math.sin(i * 2.17) * 0.5 - 0.25) * 0.08;
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
  }), [orbitRadius]);
  useFrame(({ clock }) => { groupRef.current.rotation.y = (clock.elapsedTime / period) * Math.PI * 2; });
  return (
    <group ref={groupRef}>
      {rocks.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.04, 4, 4]} />
          <meshStandardMaterial color="#6b7280" roughness={1} metalness={0} />
        </mesh>
      ))}
      <Html position={[orbitRadius * 0.72, 0.15, orbitRadius * 0.72]} center style={{ pointerEvents: "none" }}>
        <span style={{ fontSize: "10px", color: "#4b5563", whiteSpace: "nowrap", textShadow: "0 1px 4px #000" }}>
          {index + 1}. Belt
        </span>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Planet (orbiting, interactive, with GLB model or procedural fallback)
// ---------------------------------------------------------------------------

interface PlanetProps {
  bodyType:    string;
  bodySize:    string;
  index:       number;
  orbitRadius: number;
  period:      number;
  initialAngle: number;
  hasColony:   boolean;
  isSelected:  boolean;
  isSupplySource: boolean;
  isSupplyTarget: boolean;
  /** Ref slot — SceneInner writes the planet's current world position here */
  worldPosSlot: React.MutableRefObject<THREE.Vector3[]>;
  onPointerDown: (idx: number, e: { clientX: number; clientY: number }) => void;
  onPointerUp:   (idx: number) => void;
  onClick:       (idx: number) => void;
}

function Planet({
  bodyType, bodySize, index, orbitRadius, period, initialAngle,
  hasColony, isSelected, isSupplySource, isSupplyTarget,
  worldPosSlot, onPointerDown, onPointerUp, onClick,
}: PlanetProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const r = planetRadius(bodySize, bodyType);
  const modelPath = MODEL_PATH[bodyType];

  useFrame(({ clock }) => {
    const angle = initialAngle + (clock.elapsedTime / period) * Math.PI * 2;
    groupRef.current.position.set(Math.cos(angle) * orbitRadius, 0, Math.sin(angle) * orbitRadius);
    // Track world position for drag hit-detection
    const wp = new THREE.Vector3();
    groupRef.current.getWorldPosition(wp);
    worldPosSlot.current[index] = wp;
  });

  const labelColor = isSelected ? "#a5b4fc" : isSupplySource ? "#fbbf24" : isSupplyTarget ? "#4ade80" : hasColony ? "#34d399" : "#4b5563";
  const label = `${index + 1}. ${bodyDisplayLabel(bodyType)}`;

  return (
    <group ref={groupRef}>
      {/* Colony ring */}
      {hasColony && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r + 0.14, 0.022, 8, 72]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.85} />
        </mesh>
      )}

      {/* Selection ring */}
      {isSelected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r + 0.30, 0.04, 8, 72]} />
          <meshBasicMaterial color="#818cf8" transparent opacity={0.9} />
        </mesh>
      )}

      {/* Supply-source ring (amber) */}
      {isSupplySource && !isSelected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r + 0.30, 0.04, 8, 72]} />
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.9} />
        </mesh>
      )}

      {/* Supply drop-target ring (green) */}
      {isSupplyTarget && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r + 0.30, 0.04, 8, 72]} />
          <meshBasicMaterial color="#4ade80" transparent opacity={0.9} />
        </mesh>
      )}

      {/* Invisible click/drag sphere (always on top for pointer events) */}
      <mesh
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(index, { clientX: e.nativeEvent.clientX, clientY: e.nativeEvent.clientY });
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          onPointerUp(index);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(index);
        }}
      >
        <sphereGeometry args={[r * 1.15, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Visual body — GLB or procedural */}
      {modelPath ? (
        <Suspense fallback={<ProceduralPlanet bodyType={bodyType} radius={r} />}>
          <PlanetModel path={modelPath} radius={r} />
        </Suspense>
      ) : (
        <ProceduralPlanet bodyType={bodyType} radius={r} />
      )}

      {/* Colony surface dot */}
      {hasColony && (
        <mesh position={[r * 0.65, r * 0.65, 0]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshBasicMaterial color="#34d399" />
        </mesh>
      )}

      {/* Label */}
      <Html position={[0, r + 0.30, 0]} center distanceFactor={10} style={{ pointerEvents: "none", userSelect: "none" }}>
        <span style={{ fontSize: "11px", color: labelColor, whiteSpace: "nowrap", textShadow: "0 1px 4px #000, 0 0 8px #000" }}>
          {label}{hasColony ? " ★" : ""}
        </span>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Station marker
// ---------------------------------------------------------------------------

function StationMarker({ starR, onClick }: { starR: number; onClick: () => void }) {
  const spinRef = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => { spinRef.current.rotation.y = clock.elapsedTime * 0.35; });
  return (
    <group position={[starR * 1.7, starR * 0.55, 0]}>
      <group ref={spinRef}>
        <mesh>
          <boxGeometry args={[0.22, 0.06, 0.22]} />
          <meshStandardMaterial color="#f59e0b" emissive="#92400e" emissiveIntensity={1.3} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.40, 0.035, 0.035]} />
          <meshStandardMaterial color="#fbbf24" emissive="#78350f" emissiveIntensity={0.8} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[0.40, 0.035, 0.035]} />
          <meshStandardMaterial color="#fbbf24" emissive="#78350f" emissiveIntensity={0.8} />
        </mesh>
      </group>
      {/* Clickable hit zone */}
      <mesh onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <sphereGeometry args={[0.35, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html position={[0, 0.42, 0]} center style={{ pointerEvents: "none" }}>
        <span style={{ fontSize: "10px", color: "#f59e0b", whiteSpace: "nowrap", textShadow: "0 1px 4px #000", cursor: "pointer" }}>
          Station ⚓
        </span>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Ship marker
// ---------------------------------------------------------------------------

function ShipMarker({ id, name, index, total, isSelected, onClick }: { id: string; name: string; index: number; total: number; isSelected: boolean; onClick: (id: string) => void }) {
  const spread = (index - (total - 1) / 2) * 0.44;
  const color = isSelected ? "#c7d2fe" : "#a5b4fc";
  return (
    <group position={[spread - 1.1, 0, 1.2]}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(id); }}>
        <coneGeometry args={[0.09, 0.28, 4]} />
        <meshStandardMaterial color={color} emissive={isSelected ? "#4f46e5" : "#3730a3"} emissiveIntensity={isSelected ? 1.2 : 0.65} />
      </mesh>
      {/* Invisible click zone */}
      <mesh onClick={(e) => { e.stopPropagation(); onClick(id); }}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html position={[0, 0.34, 0]} center style={{ pointerEvents: "none" }}>
        <span style={{ fontSize: "9px", color, whiteSpace: "nowrap", textShadow: "0 1px 4px #000" }}>
          {name}
        </span>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Fleet marker
// ---------------------------------------------------------------------------

function FleetMarker({ name, index, total }: { name: string; index: number; total: number }) {
  const spread = (index - (total - 1) / 2) * 0.44;
  return (
    <group position={[spread + 0.9, 0, 1.2]}>
      <mesh>
        <tetrahedronGeometry args={[0.12, 0]} />
        <meshStandardMaterial color="#c4b5fd" emissive="#5b21b6" emissiveIntensity={0.65} />
      </mesh>
      <Html position={[0, 0.28, 0]} center style={{ pointerEvents: "none" }}>
        <span style={{ fontSize: "9px", color: "#c4b5fd", whiteSpace: "nowrap", textShadow: "0 1px 4px #000" }}>
          {name}
        </span>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Inner scene (inside Canvas context)
// ---------------------------------------------------------------------------

interface SceneInnerProps {
  system:           SolarSceneSystemData;
  ships:            SolarSceneShipData[];
  fleets:           SolarSceneFleetData[];
  colonyBodyIndices: Set<number>;
  stationHere:      boolean;
  selectedBodyIndex:  number | null;
  supplySourceIdx:    number | null;
  onPlanetClick:    (idx: number) => void;
  onSupplyDragStart: (idx: number) => void;
  onSupplyDrop:     (toIdx: number) => void;
  onSupplyCancel:   () => void;
  onStationClick:   () => void;
  onShipClick:      (id: string) => void;
  selectedShipId:   string | null;
}

function SceneInner({
  system, ships, fleets, colonyBodyIndices, stationHere,
  selectedBodyIndex, supplySourceIdx,
  onPlanetClick, onSupplyDragStart, onSupplyDrop, onSupplyCancel,
  onStationClick, onShipClick, selectedShipId,
}: SceneInnerProps) {
  const starR = STAR_RADIUS[system.spectralClass] ?? 0.80;

  // Orbital radii
  const orbits = useMemo(() => {
    const count = system.bodies.length;
    const minR = starR + 1.5, maxR = 7.6;
    return system.bodies.map((_, i) => count <= 1 ? minR + (maxR - minR) * 0.4 : minR + (maxR - minR) * (i / (count - 1)));
  }, [system.bodies, starR]);

  const periods = useMemo(() => {
    const base = orbits[0] ?? 1;
    return orbits.map((r) => Math.round(20 * Math.pow(r / base, 1.5)));
  }, [orbits]);

  const initialAngles = useMemo(() => {
    const N = system.bodies.length;
    return system.bodies.map((_, i) => N > 1 ? (i / N) * Math.PI * 2 : 0);
  }, [system.bodies]);

  // ── Drag state ─────────────────────────────────────────────────────────────
  const isDragging     = useRef(false);
  const dragSourceIdxR = useRef(-1);
  const pointerDownPos = useRef({ clientX: 0, clientY: 0 });
  const planetWorldPos = useRef<THREE.Vector3[]>([]);
  const [dragLinePoints, setDragLinePoints] = useState<[THREE.Vector3, THREE.Vector3] | null>(null);

  const { gl, camera } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const srcPos = planetWorldPos.current[dragSourceIdxR.current];
      if (!srcPos) return;
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera as THREE.PerspectiveCamera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, hit)) {
        setDragLinePoints([srcPos.clone(), hit]);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setDragLinePoints(null);

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // Find nearest planet by screen-space proximity
      let nearest = -1;
      let nearestDist = 70; // px snap radius
      const cam = camera as THREE.PerspectiveCamera;
      for (let i = 0; i < planetWorldPos.current.length; i++) {
        if (i === dragSourceIdxR.current) continue;
        const wp = planetWorldPos.current[i];
        if (!wp) continue;
        const ndc = wp.clone().project(cam);
        const px = ((ndc.x + 1) / 2) * canvas.clientWidth;
        const py = ((1 - ndc.y) / 2) * canvas.clientHeight;
        const dist = Math.sqrt((sx - px) ** 2 + (sy - py) ** 2);
        if (dist < nearestDist) { nearestDist = dist; nearest = i; }
      }

      if (nearest >= 0) {
        onSupplyDrop(nearest);
      } else {
        onSupplyCancel();
      }
      dragSourceIdxR.current = -1;
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup",   handlePointerUp);
    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup",   handlePointerUp);
    };
  }, [gl, camera, onSupplyDrop, onSupplyCancel]);

  // ── Planet interaction handlers ────────────────────────────────────────────
  const handlePlanetPointerDown = (idx: number, pos: { clientX: number; clientY: number }) => {
    pointerDownPos.current = pos;
  };

  const handlePlanetPointerUp = (idx: number) => {
    // Drag distance (ignore tiny movements)
    if (isDragging.current) return; // pointerup already handled by canvas listener
  };

  const handlePlanetClick = (idx: number) => {
    // If in supply mode and clicking a different planet → confirm drop
    if (supplySourceIdx !== null && idx !== supplySourceIdx) {
      onSupplyDrop(idx);
      return;
    }
    onPlanetClick(idx);
  };

  const handleDragStart = (idx: number, pos: { clientX: number; clientY: number }) => {
    isDragging.current = true;
    dragSourceIdxR.current = idx;
    pointerDownPos.current = pos;
    onSupplyDragStart(idx);
  };

  // We distinguish drag vs click by watching for significant movement.
  // Use a wrapper that starts drag on large move.
  const handlePlanetPointerDownFull = (idx: number, pos: { clientX: number; clientY: number }) => {
    pointerDownPos.current = pos;
    const canvas = gl.domElement;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.current.clientX;
      const dy = e.clientY - pointerDownPos.current.clientY;
      if (Math.sqrt(dx * dx + dy * dy) > 6) {
        // Threshold crossed — start drag
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        handleDragStart(idx, { clientX: e.clientX, clientY: e.clientY });
      }
    };
    const onUp = () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
  };

  return (
    <>
      <ambientLight intensity={0.12} />
      <Stars radius={90} depth={60} count={3500} factor={3.5} saturation={0} fade />
      <Star spectralClass={system.spectralClass} />

      {stationHere && <StationMarker starR={starR} onClick={onStationClick} />}

      {ships.map((s, i) => (
        <ShipMarker
          key={s.id}
          id={s.id}
          name={s.name}
          index={i}
          total={ships.length}
          isSelected={s.id === selectedShipId}
          onClick={onShipClick}
        />
      ))}

      {fleets.map((f, i) => (
        <FleetMarker key={f.id} name={f.name} index={i} total={fleets.length} />
      ))}

      {/* Tilted orbital plane */}
      <group rotation={[0.22, 0, 0.04]}>
        {system.bodies.map((body, i) => (
          <OrbitalRing key={`ring-${i}`} radius={orbits[i]} dashed={body.type === "asteroid_belt"} />
        ))}
        {system.bodies.map((body, i) =>
          body.type === "asteroid_belt" ? (
            <AsteroidBelt key={`belt-${i}`} orbitRadius={orbits[i]} period={periods[i] * 2.5} index={i} />
          ) : null,
        )}
        {system.bodies.map((body, i) =>
          body.type !== "asteroid_belt" ? (
            <Planet
              key={`planet-${i}`}
              bodyType={body.type}
              bodySize={body.size}
              index={i}
              orbitRadius={orbits[i]}
              period={periods[i]}
              initialAngle={initialAngles[i]}
              hasColony={colonyBodyIndices.has(i)}
              isSelected={selectedBodyIndex === i}
              isSupplySource={supplySourceIdx === i}
              isSupplyTarget={supplySourceIdx !== null && supplySourceIdx !== i}
              worldPosSlot={planetWorldPos}
              onPointerDown={handlePlanetPointerDownFull}
              onPointerUp={handlePlanetPointerUp}
              onClick={handlePlanetClick}
            />
          ) : null,
        )}

        {/* Drag line */}
        {dragLinePoints && (
          <Line
            points={dragLinePoints}
            color="#a5b4fc"
            lineWidth={2}
            dashed
            dashSize={0.3}
            gapSize={0.15}
          />
        )}
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SolarSceneSystemData {
  name:          string;
  spectralClass: string;
  bodies: Array<{
    type: string;
    size: string;
  }>;
}

export interface SolarSceneShipData {
  id:            string;
  name:          string;
  dispatch_mode: string;
  cargo_cap?:    number;
  speed_ly_per_hr?: number;
  ship_state?:   string;
}

export interface SolarSceneFleetData {
  id:     string;
  name:   string;
  status: string;
}

export interface SolarSceneProps {
  system:              SolarSceneSystemData;
  ships:               SolarSceneShipData[];
  fleets:              SolarSceneFleetData[];
  coloniesBodyIndices: number[];
  stationHere:         boolean;
  selectedBodyIndex:   number | null;
  supplySourceIdx:     number | null;
  selectedShipId:      string | null;
  onPlanetClick:       (idx: number) => void;
  onSupplyDragStart:   (idx: number) => void;
  onSupplyDrop:        (toIdx: number) => void;
  onSupplyCancel:      () => void;
  onStationClick:      () => void;
  onShipClick:         (id: string) => void;
}

// ---------------------------------------------------------------------------
// Canvas export
// ---------------------------------------------------------------------------

export function SolarScene({
  system, ships, fleets, coloniesBodyIndices, stationHere,
  selectedBodyIndex, supplySourceIdx, selectedShipId,
  onPlanetClick, onSupplyDragStart, onSupplyDrop, onSupplyCancel,
  onStationClick, onShipClick,
}: SolarSceneProps) {
  const colonySet = useMemo(() => new Set(coloniesBodyIndices), [coloniesBodyIndices]);

  return (
    <Canvas
      camera={{ position: [0, 7.5, 13], fov: 55, near: 0.1, far: 500 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: "#06060a", width: "100%", height: "100%" }}
    >
      <SceneInner
        system={system}
        ships={ships}
        fleets={fleets}
        colonyBodyIndices={colonySet}
        stationHere={stationHere}
        selectedBodyIndex={selectedBodyIndex}
        supplySourceIdx={supplySourceIdx}
        selectedShipId={selectedShipId}
        onPlanetClick={onPlanetClick}
        onSupplyDragStart={onSupplyDragStart}
        onSupplyDrop={onSupplyDrop}
        onSupplyCancel={onSupplyCancel}
        onStationClick={onStationClick}
        onShipClick={onShipClick}
      />
      <OrbitControls
        enablePan={false}
        minDistance={3.5}
        maxDistance={22}
        enableDamping
        dampingFactor={0.06}
      />
    </Canvas>
  );
}
