import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Starfall Atlas",
  description:
    "A shared-universe browser strategy and economy game built on real star data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
