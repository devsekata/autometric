import type { Mode } from './AuthPage';

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
      {/* Hero image */}
      <img src="/hero.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />

      {/* Dark overlay */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(160deg, rgba(5,5,10,0.93) 0%, rgba(10,8,20,0.82) 50%, rgba(20,15,35,0.72) 100%)',
        }}
      />

      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full pt-1 p-12">
        {/* Logo */}
        <div className="shrink-0">
          <img
            src="/auometric-logo-long.png"
            alt="Autometric"
            style={{ height: 150, width: 'auto', objectFit: 'contain' }}
          />
        </div>

        {/* Center tagline */}
        <div
          key={mode}
          className="flex-1 flex flex-col justify-center"
          style={{ animation: 'fadeSlideUp 0.45s ease both' }}
        >
          <p
            className="font-extrabold text-white leading-tight"
            style={{
              fontSize: '3rem',
              letterSpacing: '-0.05em',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              maxWidth: 400,
            }}
          >
            Track every brand. <span style={{ color: '#a5b4fc' }}>Outperform</span> every
            competitor.
          </p>
          <p
            className="mt-5"
            style={{
              fontSize: '1.0625rem',
              color: 'rgba(255,255,255,0.6)',
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.65,
              maxWidth: 480,
            }}
          >
            One platform for brand analytics, competitor tracking, and social media insights.
          </p>
        </div>

        {/* Bottom brand mark */}
        <p
          className="shrink-0"
          style={{
            fontSize: '0.75rem',
            color: 'rgba(255,255,255,0.25)',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          © 2026 Autometric. All rights reserved.
        </p>
      </div>
    </div>
  );
}
