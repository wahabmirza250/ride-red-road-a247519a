/**
 * Decorative "living map" hero — SVG illustration of a stylized city grid,
 * a route, an animated car, and a dropped pin. No network calls, no API key.
 * Purely presentational; sits behind the lookup card on the passenger home.
 */
export function HeroMap() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Map plate */}
      <div className="absolute inset-0 animate-map-pan">
        <svg
          viewBox="0 0 800 600"
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id="mapBg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="oklch(0.985 0.006 60)" />
              <stop offset="100%" stopColor="oklch(0.955 0.012 30)" />
            </linearGradient>
            <linearGradient id="route" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="oklch(0.56 0.19 15)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="oklch(0.68 0.19 25)" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          <rect width="800" height="600" fill="url(#mapBg)" />

          {/* Blocks */}
          <g fill="oklch(0.94 0.008 60)">
            <rect x="40"  y="40"  width="180" height="120" rx="10" />
            <rect x="240" y="40"  width="230" height="80"  rx="10" />
            <rect x="490" y="40"  width="270" height="140" rx="10" />
            <rect x="40"  y="180" width="120" height="180" rx="10" />
            <rect x="180" y="200" width="290" height="90"  rx="10" />
            <rect x="490" y="200" width="140" height="90"  rx="10" />
            <rect x="650" y="200" width="110" height="200" rx="10" />
            <rect x="40"  y="380" width="240" height="180" rx="10" />
            <rect x="300" y="310" width="330" height="130" rx="10" />
            <rect x="300" y="460" width="200" height="100" rx="10" />
            <rect x="520" y="460" width="240" height="100" rx="10" />
          </g>

          {/* Park */}
          <rect x="180" y="130" width="80" height="60" rx="8" fill="oklch(0.86 0.09 155)" opacity="0.55" />

          {/* Water */}
          <path
            d="M0 520 Q 200 480 400 520 T 800 520 L 800 600 L 0 600 Z"
            fill="oklch(0.9 0.05 235)"
            opacity="0.55"
          />

          {/* Minor streets */}
          <g stroke="oklch(0.88 0.006 60)" strokeWidth="4" strokeLinecap="round" opacity="0.9">
            <line x1="0" y1="170" x2="800" y2="170" />
            <line x1="0" y1="300" x2="800" y2="300" />
            <line x1="0" y1="450" x2="800" y2="450" />
            <line x1="170" y1="0" x2="170" y2="600" />
            <line x1="470" y1="0" x2="470" y2="600" />
            <line x1="640" y1="0" x2="640" y2="600" />
          </g>

          {/* Featured route (the "your driver is coming" line) */}
          <path
            id="hero-route"
            d="M 60 470 Q 220 470 300 380 T 560 300 Q 640 260 740 180"
            fill="none"
            stroke="url(#route)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray="1 12"
          />
          {/* Solid glow underlay */}
          <path
            d="M 60 470 Q 220 470 300 380 T 560 300 Q 640 260 740 180"
            fill="none"
            stroke="oklch(0.56 0.19 15)"
            strokeOpacity="0.18"
            strokeWidth="14"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Animated car sliding along the top band */}
      <div className="absolute left-0 right-0 top-[32%] h-8 animate-car-drive">
        <div className="ml-8 flex h-8 w-14 items-center justify-center rounded-md bg-brand-ink text-primary-foreground shadow-lift">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M5 11l1.5-4A2 2 0 0 1 8.4 5.6h7.2a2 2 0 0 1 1.9 1.4L19 11h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1v1a1 1 0 1 1-2 0v-1H7v1a1 1 0 1 1-2 0v-1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h1zm2.1 0h9.8l-1-2.7a.5.5 0 0 0-.5-.3H8.6a.5.5 0 0 0-.5.3L7.1 11zM7 14a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm10 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
          </svg>
        </div>
      </div>

      {/* Dropped pin, centered on hero */}
      <div className="absolute left-1/2 top-[46%]">
        <span className="absolute left-0 top-0 block h-6 w-6 rounded-full bg-primary/40 animate-radar-ping" />
        <span className="absolute left-0 top-0 block h-6 w-6 rounded-full bg-primary/25 animate-radar-ping [animation-delay:1s]" />
        <div className="animate-pin-drop">
          <svg viewBox="0 0 24 24" className="h-9 w-9 drop-shadow-[0_6px_10px_rgba(180,30,40,0.35)]" aria-hidden>
            <path
              d="M12 2C7.6 2 4 5.4 4 9.6c0 5.4 6.6 11.4 7.3 12a1 1 0 0 0 1.4 0C13.4 21 20 15 20 9.6 20 5.4 16.4 2 12 2z"
              fill="oklch(0.56 0.19 15)"
            />
            <circle cx="12" cy="9.6" r="3" fill="white" />
          </svg>
        </div>
      </div>

      {/* Soft fade into the page so the card sits over a calm surface */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent via-background/60 to-background" />
    </div>
  );
}
