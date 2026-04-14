import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@react-three/fiber", "@react-three/drei", "three"],
};

export default nextConfig;
