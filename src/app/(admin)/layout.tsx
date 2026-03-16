/**
 * Admin route group layout.
 * All routes under /admin use this layout.
 * The admin guard check happens in each individual page/route.
 */

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-3">
        <span className="text-sm font-mono text-zinc-400">
          Starfall Atlas — Admin
        </span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
