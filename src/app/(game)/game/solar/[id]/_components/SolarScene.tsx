/**
 * SolarScene — client-side 3D solar system view.
 *
 * Renders a true 3D scene using React Three Fiber + Drei:
 *   - Central star (emissive sphere, colour/size by spectral class)
 *   - Orbital rings on a tilted plane (~12.5° inclination)
 *   - Planets (procedural spheres, will swap to .glb when models ship)
 *   - Labels pinned to the moving planets via Drei <Html>
 *   - Planets pass in front of / behind the star — full WebGL depth
 *   - Station placeholder model near the star (if present)
 *   - Ship/fleet presence icons near the star
 *   - OrbitControls for free look (no pan, constrained zoom)
 *
 * .glb model swap:
 *   Each planet type has a slot comment where useGLTF() would replace
 *   the procedural sphere. Until the model files land in /public/models/,
 *   procedural geometry is used so the scene is always renderable.
 *
 * @module SolarScene
 */

"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Stars, OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";

// ── Spectral-class colour tables ───────────────────────────────────────────────

const STAR_COLOR: Record<string, string> = {
  O: "#93c5fd", B: "#93c5fd", A: "#bfdbfe",
  F: "#fef3c7", G: "#fde68a", K: "#fdba74", M: "#fca5a5",
};

const STAR_EMISSIVE: Record<string, string> = {
  O: "#3b82f6", B: "#3b82f6", A: "#60a5fa",
  F: "#fbbf24", G: "#f59e0b", K: "#f97316", M: "#ef4444",
};

/** Star radius in scene units (Three.js world units). */
const STAR_RADIUS: Record<string, number> = {
  O: 1.40, B: 1.20, A: 1.00, F: 0.90, G: 0.80, K: 0.70, M: 0.55,
};

// ── Planet colour table ────────────────────────────────────────────────────────

const PLANET_COLOR: Record<string, string> = {
  lush:         "#4ade80",
  habitable:    "#86efac",
  ocean:        "#38bdf8",
  rocky:        "#a8a29e",
  barren:       "#78716c",
  desert:       "#fbbf24",
  frozen:       "#bae6fd",
  ice_planet:   "#7dd3fc",
  ice_giant:    "#67e8f9",
  gas_giant:    "#fb923c",
  volcanic:     "#f87171",
  toxic:        "#a3e635",
  asteroid_belt:"#6b7280",
};

const PLANET_ROUGHNESS: Record<string, number> = {
  gas_giant: 0.15, ice_giant: 0.15,
  volcanic: 0.45,  ocean: 0.30,
  lush: 0.65,      frozen: 0.50,
};

function planetRadius(size: string, type: string): number {
  if (type === "gas_giant" || type === "ice_giant") {
    return (
      ({ tiny: 0.28, small: 0.34, medium: 0.42, large: 0.52, huge: 0.64 } as Record<string, number>)[size] ?? 0.38
    );
  }
  return (
    ({ tiny: 0.12, small: 0.16, medium: 0.22, large: 0.28, huge: 0.34 } as Record<string, number>)[size] ?? 0.18
  );
}

function bodyDisplayLabel(type: string): string {
  return ({
    lush: "Lush", habitable: "Habitable", ocean: "Ocean", rocky: "Rocky",
    barren: "Barren", desert: "Desert", frozen: "Frozen", ice_planet: "Ice Planet",
    ice_giant: "Ice Giant", gas_giant: "Gas Giant", volcanic: "Volcanic",
    toxic: "Toxic", asteroid_belt: "Belt",
  } as Record<string, string>)[type] ?? type;
}

// ── Star ───────────────────────────────────────────────────────────────────────

function Star({ spectralClass }: { spectralClass: string }) {
  const r      = STAR_RADIUS[spectralClass]   ?? 0.80;
  const color  = STAR_COLOR[spectralClass]    ?? "#fde68a";
  const emissv = STAR_EMISSIVE[spectralClass] ?? "#b45309";

  return (
    <group>
      {/* Outer diffuse corona */}
      <mesh renderOrder={-2}>
        <sphereGeometry args={[r * 3.8, 16, 16]} />
        <meshBasicMaterial
          color={emissv}
          transparent
          opacity={0.04}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      {/* Mid halo */}
      <mesh renderOrder={-1}>
        <sphereGeometry args={[r * 2.2, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.09}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      {/* Main star body — planets occlude this properly via depth test */}
      <mesh>
        <sphereGeometry args={[r, 64, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={emissv}
          emissiveIntensity={2.2}
          roughness={0.45}
          metalness={0.00}
        />
      </mesh>
      {/* Scene illumination */}
      <pointLight color={color} intensity={5} distance={28} decay={1.8} />
    </group>
  );
}

// ── Orbital ring (XZ plane of parent group) ────────────────────────────────────

function OrbitalRing({ radius, dashed = false }: { radius: number; dashed?: boolean }) {
  const pts = useMemo(() => {
    const N = dashed ? 96 : 160;
    return Array.from({ length: N + 1 }, (_, i) => {
      const a = (i / N) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    });
  }, [radius, dashed]);

  return (
    <Line
      points={pts}
      color={dashed ? "#374151" : "#1f2937"}
      lineWidth={0.6}
      transparent
      opacity={dashed ? 0.4 : 0.55}
    />
  );
}

// ── Asteroid belt (slow-rotating cloud of rocks) ───────────────────────────────

function AsteroidBelt({
  orbitRadius,
  period,
  index,
}: {
  orbitRadius: number;
  period: number;
  index: number;
}) {
  const groupRef = useRef<THREE.Group>(null!);

  // Scatter rocks around the ring
  const rocks = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const a      = (i / 30) * Math.PI * 2;
      const rFrac  = 0.97 + (Math.sin(i * 7.31) * 0.5 + 0.5) * 0.06;
      const r      = orbitRadius * rFrac;
      const yOff   = (Math.sin(i * 2.17) * 0.5 - 0.25) * 0.08;
      return { x: Math.cos(a) * r, y: yOff, z: Math.sin(a) * r };
    });
  }, [orbitRadius]);

  useFrame(({ clock }) => {
    groupRef.current.rotation.y = (clock.elapsedTime / period) * Math.PI * 2;
  });

  return (
    <group ref={groupRef}>
      {rocks.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.04, 4, 4]} />
          <meshStandardMaterial color="#6b7280" roughness={1} metalness={0} />
        </mesh>
      ))}
      {/* Label on a fixed arm */}
      <Html
        position={[orbitRadius * 0.72, 0.15, orbitRadius * 0.72]}
        center
        style={{ pointerEvents: "none" }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "#4b5563",
            whiteSpace: "nowrap",
            textShadow: "0 1px 4px #000",
          }}
        >
          {index + 1}. Belt
        </span>
      </Html>
    </group>
  );
}

// ── Planet ─────────────────────────────────────────────────────────────────────

interface PlanetProps {
  bodyType:     string;
  bodySize:     string;
  index:        number;
  orbitRadius:  number;
  period:       number;
  initialAngle: number;
  hasColony:    boolean;
}

function Planet({
  bodyType,
  bodySize,
  index,
  orbitRadius,
  period,
  initialAngle,
  hasColony,
}: PlanetProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const r        = planetRadius(bodySize, bodyType);
  const color    = PLANET_COLOR[bodyType]    ?? "#9ca3af";
  const rough    = PLANET_ROUGHNESS[bodyType] ?? 0.78;

  useFrame(({ clock }) => {
    const angle = initialAngle + (clock.elapsedTime / period) * Math.PI * 2;
    groupRef.current.position.set(
      Math.cos(angle) * orbitRadius,
      0,
      Math.sin(angle) * orbitRadius,
    );
  });

  const label = `${index + 1}. ${bodyDisplayLabel(bodyType)}`;

  return (
    <group ref={groupRef}>
      {/* Colony ring — dashed torus around colonised worlds */}
      {hasColony && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r + 0.14, 0.022, 8, 72]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.85} />
        </mesh>
      )}

      {/*
       * PLANET BODY
       * GLB SWAP POINT: replace <sphereGeometry> with useGLTF() when
       * /public/models/planet_<bodyType>.glb is available.
       * e.g.:
       *   const { scene } = useGLTF(`/models/planet_${bodyType}.glb`)
       *   return <primitive object={scene.clone()} scale={r} />
       */}
      <mesh>
        <sphereGeometry args={[r, 36, 24]} />
        <meshStandardMaterial
          color={color}
          roughness={rough}
          metalness={bodyType === "volcanic" ? 0.25 : 0.02}
        />
      </mesh>

      {/* Colony surface dot */}
      {hasColony && (
        <mesh position={[r * 0.65, r * 0.65, 0]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshBasicMaterial color="#34d399" />
        </mesh>
      )}

      {/* Label — pinned to planet, moves with it */}
      <Html
        position={[0, r + 0.26, 0]}
        center
        distanceFactor={10}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <span
          style={{
            fontSize: "11px",
            color: hasColony ? "#34d399" : "#4b5563",
            whiteSpace: "nowrap",
            textShadow: "0 1px 4px #000, 0 0 8px #000",
          }}
        >
          {label}
          {hasColony ? " ★" : ""}
        </span>
      </Html>
    </group>
  );
}

// ── Station placeholder ────────────────────────────────────────────────────────

function StationMarker({ starR }: { starR: number }) {
  const spinRef = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    spinRef.current.rotation.y = clock.elapsedTime * 0.35;
  });

  return (
    <group position={[starR * 1.7, starR * 0.55, 0]}>
      <group ref={spinRef}>
        {/*
         * STATION MODEL SWAP POINT: replace with
         *   const { scene } = useGLTF("/models/station.glb")
         *   <primitive object={scene.clone()} scale={0.25} />
         * when the final station model is ready.
         */}
        {/* Hub */}
        <mesh>
          <boxGeometry args={[0.22, 0.06, 0.22]} />
          <meshStandardMaterial
            color="#f59e0b"
            emissive="#92400e"
            emissiveIntensity={1.3}
          />
        </mesh>
        {/* Solar arm A */}
        <mesh>
          <boxGeometry args={[0.40, 0.035, 0.035]} />
          <meshStandardMaterial color="#fbbf24" emissive="#78350f" emissiveIntensity={0.8} />
        </mesh>
        {/* Solar arm B */}
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[0.40, 0.035, 0.035]} />
          <meshStandardMaterial color="#fbbf24" emissive="#78350f" emissiveIntensity={0.8} />
        </mesh>
      </group>

      <Html
        position={[0, 0.38, 0]}
        center
        style={{ pointerEvents: "none" }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "#f59e0b",
            whiteSpace: "nowrap",
            textShadow: "0 1px 4px #000",
          }}
        >
          Station
        </span>
      </Html>
    </group>
  );
}

// ── Ship presence marker ───────────────────────────────────────────────────────

function ShipMarker({
  name,
  index,
  total,
}: {
  name: string;
  index: number;
  total: number;
}) {
  const spread = (index - (total - 1) / 2) * 0.44;

  return (
    <group position={[spread - 1.1, 0, 1.2]}>
      {/* SHIP SWAP: replace with GLB model when /public/models/ship.glb exists */}
      <mesh>
        <coneGeometry args={[0.07, 0.24, 4]} />
        <meshStandardMaterial
          color="#a5b4fc"
          emissive="#3730a3"
          emissiveIntensity={0.65}
        />
      </mesh>
      <Html
        position={[0, 0.30, 0]}
        center
        style={{ pointerEvents: "none" }}
      >
        <span
          style={{
            fontSize: "9px",
            color: "#a5b4fc",
            whiteSpace: "nowrap",
            textShadow: "0 1px 4px #000",
          }}
        >
          {name}
        </span>
      </Html>
    </group>
  );
}

// ── Fleet presence marker ──────────────────────────────────────────────────────

function FleetMarker({
  name,
  index,
  total,
}: {
  name: string;
  index: number;
  total: number;
}) {
  const spread = (index - (total - 1) / 2) * 0.44;

  return (
    <group position={[spread + 0.9, 0, 1.2]}>
      <mesh>
        <tetrahedronGeometry args={[0.12, 0]} />
        <meshStandardMaterial
          color="#c4b5fd"
          emissive="#5b21b6"
          emissiveIntensity={0.65}
        />
      </mesh>
      <Html
        position={[0, 0.28, 0]}
        center
        style={{ pointerEvents: "none" }}
      >
        <span
          style={{
            fontSize: "9px",
            color: "#c4b5fd",
            whiteSpace: "nowrap",
            textShadow: "0 1px 4px #000",
          }}
        >
          {name}
        </span>
      </Html>
    </group>
  );
}

// ── Inner scene (inside Canvas context) ───────────────────────────────────────

interface SceneInnerProps {
  system: SolarSceneSystemData;
  ships:  SolarSceneShipData[];
  fleets: SolarSceneFleetData[];
  colonyBodyIndices: Set<number>;
  stationHere: boolean;
}

function SceneInner({
  system,
  ships,
  fleets,
  colonyBodyIndices,
  stationHere,
}: SceneInnerProps) {
  const starR = STAR_RADIUS[system.spectralClass] ?? 0.80;

  // Orbital radii spread between starR+1.4 and 7.6 scene units
  const orbits = useMemo(() => {
    const count  = system.bodies.length;
    const minR   = starR + 1.5;
    const maxR   = 7.6;
    return system.bodies.map((_, i) => {
      if (count <= 1) return minR + (maxR - minR) * 0.4;
      return minR + (maxR - minR) * (i / (count - 1));
    });
  }, [system.bodies, starR]);

  // Orbital periods (seconds of real time): Keplerian scaling
  const periods = useMemo(() => {
    const base = orbits[0] ?? 1;
    return orbits.map(r => Math.round(20 * Math.pow(r / base, 1.5)));
  }, [orbits]);

  // Initial phase angles — evenly distributed so planets start spread out
  const initialAngles = useMemo(() => {
    const N = system.bodies.length;
    return system.bodies.map((_, i) =>
      N > 1 ? (i / N) * Math.PI * 2 : 0,
    );
  }, [system.bodies]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.12} />

      {/* Starfield */}
      <Stars radius={90} depth={60} count={3500} factor={3.5} saturation={0} fade />

      {/* Central star */}
      <Star spectralClass={system.spectralClass} />

      {/* Station near star (not on orbital plane) */}
      {stationHere && <StationMarker starR={starR} />}

      {/* Ship markers (near star, world-space) */}
      {ships.map((s, i) => (
        <ShipMarker key={s.id} name={s.name} index={i} total={ships.length} />
      ))}

      {/* Fleet markers (near star, world-space) */}
      {fleets.map((f, i) => (
        <FleetMarker key={f.id} name={f.name} index={i} total={fleets.length} />
      ))}

      {/*
       * ── Tilted orbital plane ────────────────────────────────────────────────
       * 0.22 rad ≈ 12.6° inclination from the horizontal.
       * The slight Z rotation (0.04 rad) gives a subtle azimuth offset so
       * the tilt doesn't look perfectly axis-aligned.
       *
       * All orbiting bodies live inside this group so they share the same
       * inclined plane, making planets visually pass in front of / behind
       * the star as they orbit.
       */}
      <group rotation={[0.22, 0, 0.04]}>
        {/* Orbital rings */}
        {system.bodies.map((body, i) => (
          <OrbitalRing
            key={`ring-${i}`}
            radius={orbits[i]}
            dashed={body.type === "asteroid_belt"}
          />
        ))}

        {/* Asteroid belts (handled separately from regular planets) */}
        {system.bodies.map((body, i) =>
          body.type === "asteroid_belt" ? (
            <AsteroidBelt
              key={`belt-${i}`}
              orbitRadius={orbits[i]}
              period={periods[i] * 2.5}
              index={i}
            />
          ) : null,
        )}

        {/* Planets */}
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
            />
          ) : null,
        )}
      </group>
    </>
  );
}

// ── Public types (prop contract for the server→client boundary) ────────────────

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
}

export interface SolarSceneFleetData {
  id:     string;
  name:   string;
  status: string;
}

export interface SolarSceneProps {
  system:             SolarSceneSystemData;
  ships:              SolarSceneShipData[];
  fleets:             SolarSceneFleetData[];
  coloniesBodyIndices: number[];
  stationHere:        boolean;
}

// ── Canvas wrapper (exported) ──────────────────────────────────────────────────

export function SolarScene({
  system,
  ships,
  fleets,
  coloniesBodyIndices,
  stationHere,
}: SolarSceneProps) {
  const colonySet = useMemo(
    () => new Set(coloniesBodyIndices),
    [coloniesBodyIndices],
  );

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
