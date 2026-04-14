"use client";

/**
 * SolarSceneWrapper — thin Client Component that loads SolarScene via
 * next/dynamic with ssr:false.
 *
 * Server Components cannot use `next/dynamic` with `ssr: false` (Turbopack
 * restriction), so this wrapper is the boundary that allows the Three.js
 * canvas to skip SSR while keeping the page itself a Server Component.
 */

import dynamic from "next/dynamic";
import type { SolarSceneProps } from "./SolarScene";

const SolarScene = dynamic(
  () => import("./SolarScene").then((m) => ({ default: m.SolarScene })),
  { ssr: false },
);

export function SolarSceneWrapper(props: SolarSceneProps) {
  return <SolarScene {...props} />;
}
