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
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      {children}
    </div>
  );
}
