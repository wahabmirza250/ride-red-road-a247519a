/** Minimalist animated aurora backdrop used on sign-in and passenger surfaces. */
export function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-32 -left-24 h-[520px] w-[520px] rounded-full bg-primary/25 blur-3xl animate-aurora-slow" />
      <div className="absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full bg-emerald-400/20 blur-3xl animate-aurora-med" />
      <div className="absolute -bottom-40 left-1/3 h-[520px] w-[520px] rounded-full bg-fuchsia-400/15 blur-3xl animate-aurora-fast" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,hsl(var(--background))_70%)]" />
    </div>
  );
}
