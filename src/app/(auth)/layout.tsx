/**
 * Auth route group layout.
 * Wraps /login and any other unauthenticated pages in a centered, minimal shell.
 */

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-950 px-4 overflow-hidden">
      {/* Atmospheric glow — mirrors landing page */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-indigo-900/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full bg-violet-900/8 blur-[100px]" />
      </div>
      <div className="relative w-full">
        {children}
      </div>
    </div>
  );
}
