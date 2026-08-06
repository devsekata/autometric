import type { Mode } from './AuthPage';

// Autometric palette. The old values here were measured off the Kepiai guideline
// deck — a violet core over black, with the capybara mark's teal→cyan for the
// headline. Autometric's mark is a single teal (#327488) and ships no guideline
// deck, so this panel is rebuilt as one tonal ramp off that hue: a deep-teal core
// burning at the upper left, falling to a near-black that keeps a teal cast
// rather than going neutral.
const INK = '#00121A';
const GRADIENT_CORE = '#1E4A58';
const NAVY = '#327488';
const TEAL = '#4E96AC';
const CYAN = '#7DB4C6';

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
      {/* Background — a deep-teal core burning at the upper left, falling away to
          black toward the lower right. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: '#000000',
          backgroundImage: [
            `radial-gradient(115% 90% at 25% 25%, ${GRADIENT_CORE} 0%, #163A49 26%, #0D2530 46%, #051318 66%, rgba(0,0,0,0) 86%)`,
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
            src="/autometric-logo-white.png"
            alt="Autometric"
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
            Every platform gives you metrics, while Autometric gives you clarity. We bring your
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
          &copy; 2026 Autometric. All rights reserved.
        </p>
      </div>
    </div>
  );
}
