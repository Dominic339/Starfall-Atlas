"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/game/map",      label: "Map" },
  { href: "/game/station",  label: "Station" },
  { href: "/game/market",   label: "Market" },
  { href: "/game/auctions", label: "Auctions" },
  { href: "/game/research", label: "Research" },
  { href: "/game/alliance", label: "Alliance" },
  { href: "/game/feed",     label: "Feed" },
  { href: "/game/command",  label: "Overview" },
] as const;

interface NavBarProps {
  handle: string;
  signOutAction: () => Promise<void>;
}

export function NavBar({ handle, signOutAction }: NavBarProps) {
  const pathname = usePathname();

  return (
    <header className="shrink-0 bg-zinc-950 relative">
      {/* Top gradient border */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-indigo-900/50 to-transparent" />

      <div className="flex items-center justify-between px-5 h-11">
        {/* Logo */}
        <Link
          href="/game/map"
          className="flex items-center gap-2 group shrink-0"
        >
          <svg
            className="w-4 h-4 text-indigo-400 animate-star-drift"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden
          >
            <circle cx="8" cy="8" r="1.8" />
            <circle cx="2.5" cy="3.5" r="0.9" opacity="0.55" />
            <circle cx="13.5" cy="2.5" r="0.9" opacity="0.55" />
            <circle cx="13" cy="12" r="0.9" opacity="0.45" />
            <circle cx="3" cy="13" r="0.7" opacity="0.35" />
            <line x1="8" y1="8" x2="2.5" y2="3.5" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
            <line x1="8" y1="8" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
            <line x1="8" y1="8" x2="13" y2="12" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
            <line x1="8" y1="8" x2="3" y2="13" stroke="currentColor" strokeWidth="0.5" opacity="0.15" />
          </svg>
          <span className="text-shimmer font-mono text-xs font-semibold tracking-widest uppercase select-none">
            Starfall Atlas
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-0.5 mx-4">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative px-2.5 py-2 text-xs font-medium transition-colors duration-150 rounded-sm
                  ${isActive
                    ? "text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                  }`}
              >
                {item.label}
                {isActive && <span className="nav-link-active-bar" />}
              </Link>
            );
          })}
        </nav>

        {/* Right: handle + sign out */}
        <div className="flex items-center gap-4 shrink-0">
          <Link
            href="/game/profile"
            className="font-mono text-xs text-zinc-400 hover:text-zinc-200 transition-colors duration-150 flex items-center gap-1.5 group"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70 group-hover:bg-emerald-400 transition-colors" />
            {handle}
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors duration-150"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
