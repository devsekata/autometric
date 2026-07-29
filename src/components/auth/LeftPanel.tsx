import type { Mode } from './AuthPage';

// Palette lifted from public/logo/[KEPIAI] LOGO GUIDELINE.pdf — do not eyeball
// replacements. GRADIENT_CORE is the measured peak of the deck's background
// slide (25% / 25%); TEAL→CYAN are the capybara mark's own gradient endpoints.
const INK = '#02000E';
const GRADIENT_CORE = '#1C0270';
const NAVY = '#2C3079';
const TEAL = '#4BBE9D';
const CYAN = '#3CC1D8';

export default function LeftPanel({ mode }: { mode: Mode }) {
  return (
    <div
      className="hidden lg:flex w-1/2 h-full flex-col relative overflow-hidden"
      style={{
        zIndex: 1,
        boxShadow: '8px 0 48px rgba(0,0,0,0.35), 2px 0 8px rgba(0,0,0,0.15)',
        borderRadius: '0 24px 24px 0',
      }}
    >
      {/* Background — the guideline deck's gradient: a violet core burning at the
          upper left, falling away to black toward the lower right. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: '#000000',
          backgroundImage: [
            `radial-gradient(115% 90% at 25% 25%, ${GRADIENT_CORE} 0%, #16014F 26%, #0C0134 46%, #04001B 66%, rgba(0,0,0,0) 86%)`,
            `radial-gradient(90% 70% at 0% 100%, ${NAVY}47 0%, rgba(0,0,0,0) 68%)`,
            `linear-gradient(160deg, ${INK} 0%, #000000 100%)`,
          ].join(', '),
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full p-12">
        {/* Logo */}
        <div className="shrink-0 mt-4">
          <img
            src="/kepiai-logo-white.png"
            alt="Kepiai"
            style={{ height: 100, width: 'auto', objectFit: 'contain' }}
          />
        </div>

        {/* Center tagline */}
        <div
          key={mode}
          className="flex-1 flex flex-col justify-center"
          style={{ animation: 'fadeSlideUp 0.45s ease both' }}
        >
          <h1
            className="font-extrabold leading-[1.04]"
            style={{
              fontSize: 'clamp(2.75rem, 3.6vw, 3.75rem)',
              letterSpacing: '-0.045em',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              maxWidth: 520,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                backgroundImage: `linear-gradient(100deg, ${TEAL} 0%, ${CYAN} 100%)`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Chill.
            </span>
            <br />
            <span style={{ color: '#ffffff' }}>We&rsquo;ve Got The Metrics.</span>
          </h1>
          <p
            className="mt-6"
            style={{
              fontSize: '1.0625rem',
              color: 'rgba(255,255,255,0.62)',
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.7,
              maxWidth: 520,
            }}
          >
            Every platform gives you metrics, while KepiAi gives you clarity. We bring your
            performance, content, audience, and campaigns into one intelligent workspace, reveal
            what actually drives results, and turn days of reporting into minutes, so you can spend
            less time explaining the numbers and more time acting on them.
          </p>
        </div>

        {/* Bottom brand mark */}
        <p
          className="shrink-0"
          style={{
            fontSize: '0.75rem',
            color: 'rgba(255,255,255,0.28)',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          &copy; 2026 Kepiai. All rights reserved.
        </p>
      </div>
    </div>
  );
}
