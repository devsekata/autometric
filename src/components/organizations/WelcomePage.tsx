'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import WelcomeNavbar from '@/components/layout/WelcomeNavbar';
import CreateOrgModal from './CreateOrgModal';
import InvitationsModal from '@/components/invitations/InvitationsModal';
import { Organization } from '@/lib/organizations/types';
import { Invitation } from '@/lib/invitations/types';

// The floating cards illustrate three real features. Labels, tiers and colors
// below mirror the actual dashboards so the hero doesn't promise a product that
// doesn't exist:
//   · Report Automation Generator  → the PPTX report builder (/reports)
//   · Comment Relevance Analysis   → AudienceDashboard
//   · Top Commenters — Leaderboard → CommunityDashboard

// The report builder's real slide types, as tiny thumbnails.
const REPORT_SLIDES = ['cover', 'chart', 'table', 'kpi'] as const;

// Tier names, ranges and colors as used in AudienceDashboard.
const RELEVANCE_TIERS = [
  { label: 'High', range: '>75', pct: 52, color: '#5fa783' },
  { label: 'Medium', range: '40–75', pct: 31, color: '#e0a458' },
  { label: 'Low', range: '<40', pct: 17, color: '#d97a7a' },
];

// Columns and tier pills as used in CommunityDashboard's leaderboard.
const TOP_COMMENTERS = [
  { rank: 1, user: '@sarah.p', plat: 'IG', platColor: '#c13584', comments: 128, tier: 'Super Fan', tierFg: '#7a4fb5', tierBg: '#f3eefb' },
  { rank: 2, user: '@budi.w', plat: 'TT', platColor: '#111827', comments: 96, tier: 'Active', tierFg: '#3d8a5f', tierBg: '#e7f3ed' },
  { rank: 3, user: '@rina.a', plat: 'FB', platColor: '#1877f2', comments: 74, tier: 'Active', tierFg: '#3d8a5f', tierBg: '#e7f3ed' },
];

interface Props {
  hasOrgs: boolean;
  firstOrgSlug: string;
  initialInvitations: Invitation[];
}

export default function WelcomePage({ hasOrgs, firstOrgSlug, initialInvitations }: Props) {
  const router = useRouter();

  const [invites, setInvites] = useState<Invitation[]>(initialInvitations);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvites, setShowInvites] = useState(false);

  function handleCreated(org: Organization) {
    router.push(`/organizations/${org.slug}/dashboard`);
  }
  function handleAccept(id: string) {
    setInvites((prev) => prev.filter((i) => i.id !== id));
  }
  function handleDecline(id: string) {
    setInvites((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <>
      <style>{`
        .wp-root {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background-color: #e9e9e7;
          background-image: radial-gradient(circle, rgba(0,0,0,0.08) 1px, transparent 1px);
          background-size: 22px 22px;
        }

        .wp-hero {
          flex: 1;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 80px 40px 100px;
          overflow: hidden;
        }

        .wp-center {
          position: relative;
          z-index: 10;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .wp-product-icon {
          width: 76px;
          height: 76px;
          background: white;
          border-radius: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 6px 24px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06);
          margin-bottom: 32px;
        }

        /* Headline keeps the statement → echo rhythm, but both tones are now
           derived from the brand navy #2C3079 instead of neutral grays. */
        .wp-h1 {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 82px;
          font-weight: 800;
          line-height: 1.0;
          letter-spacing: -0.04em;
          margin: 0;
          color: #2C3079;
        }

        .wp-h1-dim {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 82px;
          font-weight: 800;
          line-height: 1.0;
          letter-spacing: -0.04em;
          margin: 0 0 24px;
          color: #6E71A0;
        }

        .wp-subtitle {
          font-size: 16px;
          color: #4A4E75;
          line-height: 1.65;
          max-width: 470px;
          margin: 0 0 36px;
        }

        .wp-cta-row {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }

        .wp-btn-main {
          height: 54px;
          padding: 0 36px;
          border-radius: 100px;
          background: #2C3079;
          color: white;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 15.5px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.15s;
          box-shadow: 0 4px 20px rgba(44,48,121,0.32);
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .wp-btn-main:hover {
          opacity: 0.88;
          transform: translateY(-1px);
        }

        .wp-btn-ghost {
          height: 54px;
          padding: 0 24px;
          border-radius: 100px;
          background: white;
          color: #374151;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 15px;
          font-weight: 600;
          border: 1.5px solid #e0e0de;
          cursor: pointer;
          transition: border-color 0.15s;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }

        .wp-btn-ghost:hover { border-color: #aaaaaa; }

        .wp-invite-dot {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #2C3079;
          color: white;
          font-size: 10px;
          font-weight: 700;
          flex-shrink: 0;
        }

        /* trend colors */
        .trend-up   { color: #16a34a; }
        .trend-flat { color: #9ca3af; }
        .trend-down { color: #dc2626; }
      `}</style>

      <div className="wp-root">
        <WelcomeNavbar />

        <div className="wp-hero">
          {/* ── Card 1: Report Automation Generator — top left, folder tab shape ── */}
          <div
            style={{
              position: 'absolute',
              top: 52,
              left: 1,
              transform: 'rotate(-10deg)',
              zIndex: 4,
              filter: 'drop-shadow(0 14px 44px rgba(0,0,0,0.13))',
            }}
          >
            {/* Folder tab */}
            <div
              style={{
                width: 100,
                height: 26,
                background: '#ebebea',
                borderRadius: '12px 12px 0 0',
              }}
            />

            {/* Main card body — gray outer */}
            <div
              style={{
                width: 270,
                background: '#ebebea',
                borderRadius: '0 0 22px 22px',
                padding: 8,
              }}
            >
              {/* White inner content */}
              <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 14,
                  }}
                >
                  <p
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: '#1a1a1a',
                      margin: 0,
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                    }}
                  >
                    Report Generator
                  </p>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      color: '#2C3079',
                      background: '#ecedf7',
                      padding: '3px 8px',
                      borderRadius: 100,
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                    }}
                  >
                    AUTO
                  </span>
                </div>

                {/* Slide thumbnails — the builder's real slide types */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                  {REPORT_SLIDES.map((kind) => (
                    <div
                      key={kind}
                      style={{
                        flex: 1,
                        height: 40,
                        background: '#f6f7fb',
                        border: '1px solid #e6e7f2',
                        borderRadius: 6,
                        padding: 5,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: kind === 'chart' ? 'flex-end' : 'flex-start',
                        gap: 3,
                      }}
                    >
                      {kind === 'cover' && (
                        <>
                          <div style={{ height: 5, width: '85%', background: '#2C3079', borderRadius: 2 }} />
                          <div style={{ height: 3, width: '60%', background: '#c9cbe0', borderRadius: 2 }} />
                        </>
                      )}
                      {kind === 'chart' && (
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 24 }}>
                          {[40, 70, 55, 95].map((h, i) => (
                            <div key={i} style={{ flex: 1, height: `${h}%`, background: i === 3 ? '#2C3079' : '#c9cbe0', borderRadius: '2px 2px 0 0' }} />
                          ))}
                        </div>
                      )}
                      {kind === 'table' && (
                        <>
                          <div style={{ height: 3, width: '100%', background: '#2C3079', borderRadius: 2 }} />
                          <div style={{ height: 3, width: '100%', background: '#d7d9e8', borderRadius: 2 }} />
                          <div style={{ height: 3, width: '100%', background: '#d7d9e8', borderRadius: 2 }} />
                          <div style={{ height: 3, width: '70%', background: '#d7d9e8', borderRadius: 2 }} />
                        </>
                      )}
                      {kind === 'kpi' && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {[0, 1, 2, 3].map((i) => (
                            <div key={i} style={{ width: 'calc(50% - 1.5px)', height: 13, background: i === 0 ? '#2C3079' : '#d7d9e8', borderRadius: 3 }} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ height: 4, background: 'rgba(0,0,0,0.07)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ width: '100%', height: '100%', background: '#2C3079', borderRadius: 4 }} />
                </div>
                <p style={{ fontSize: 11.5, color: '#8a8ca6', margin: 0 }}>6 slides · PPTX ready</p>
              </div>
            </div>
          </div>

          {/* ── Card 2: Social Platforms — bottom right, folder tab, large icons ── */}
          <div
            style={{
              position: 'absolute',
              top: 50,
              right: 30,
              transform: 'rotate(5deg)',
              zIndex: 4,
              filter: 'drop-shadow(0 12px 36px rgba(0,0,0,0.11))',
            }}
          >
            {/* Folder tab */}
            <div
              style={{
                width: 100,
                height: 26,
                background: '#ebebea',
                borderRadius: '12px 12px 0 0',
              }}
            />

            {/* Gray outer */}
            <div
              style={{
                width: 310,
                background: '#ebebea',
                borderRadius: '0 0 22px 22px',
                padding: 8,
              }}
            >
              {/* White inner */}
              <div style={{ background: '#ebebea', borderRadius: 14, padding: '20px 20px 26px' }}>
                <p
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: '#1a1a1a',
                    margin: '0 0 3px',
                    fontFamily: "'Plus Jakarta Sans',sans-serif",
                  }}
                >
                  3+ Social Platforms
                </p>
                <p style={{ fontSize: 11.5, color: '#aaaaaa', margin: '0 0 22px' }}>
                  Connected &amp; tracking
                </p>

                {/* Large staggered logo images */}
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
                  {/* Instagram */}
                  <div
                    style={{
                      width: 82,
                      height: 82,
                      borderRadius: 22,
                      overflow: 'hidden',
                      flexShrink: 0,
                      transform: 'rotate(-8deg) translateY(0px)',
                      boxShadow: '0 6px 18px rgba(131,58,180,0.30)',
                      zIndex: 3,
                      position: 'relative',
                    }}
                  >
                    <img
                      src="/tt.png"
                      alt="Instagram"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  </div>
                  {/* TikTok */}
                  <div
                    style={{
                      width: 90,
                      height: 90,
                      borderRadius: 24,
                      overflow: 'hidden',
                      flexShrink: 0,
                      transform: 'rotate(2deg) translateY(-16px)',
                      marginLeft: -12,
                      boxShadow: '0 6px 18px rgba(0,0,0,0.26)',
                      zIndex: 2,
                      position: 'relative',
                    }}
                  >
                    <img
                      src="/ig.webp"
                      alt="TikTok"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  </div>
                  {/* Facebook */}
                  <div
                    style={{
                      width: 78,
                      height: 78,
                      borderRadius: 20,
                      overflow: 'hidden',
                      flexShrink: 0,
                      transform: 'rotate(10deg) translateY(-6px)',
                      marginLeft: -12,
                      boxShadow: '0 6px 18px rgba(24,119,242,0.30)',
                      zIndex: 1,
                      position: 'relative',
                    }}
                  >
                    <img
                      src="/fb.png"
                      alt="Facebook"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Card 3: Comment Relevance Analysis — bottom left, folder tab ── */}
          <div
            style={{
              position: 'absolute',
              bottom: 30,
              left: 70,
              transform: 'rotate(3deg)',
              zIndex: 4,
              filter: 'drop-shadow(0 12px 36px rgba(0,0,0,0.11))',
            }}
          >
            {/* Folder tab */}
            <div
              style={{
                width: 100,
                height: 26,
                background: '#ebebea',
                borderRadius: '12px 12px 0 0',
              }}
            />

            {/* Gray outer */}
            <div
              style={{
                width: 274,
                background: '#ebebea',
                borderRadius: '0 0 20px 20px',
                padding: 8,
              }}
            >
              {/* White inner */}
              <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 14,
                  }}
                >
                  <p
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: '#1a1a1a',
                      margin: 0,
                      whiteSpace: 'nowrap',
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                    }}
                  >
                    Comment Relevance
                  </p>
                  <span style={{ fontSize: 11, color: '#aaaaaa' }}>Semantic</span>
                </div>

                {/* Distribution — one bar, split by tier */}
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
                  {RELEVANCE_TIERS.map((t) => (
                    <div key={t.label} style={{ width: `${t.pct}%`, background: t.color }} />
                  ))}
                </div>

                {RELEVANCE_TIERS.map((t) => (
                  <div
                    key={t.label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 11,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: t.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 12.5, color: '#374151' }}>{t.label}</span>
                      <span style={{ fontSize: 11, color: '#aaaaaa' }}>{t.range}</span>
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111827' }}>
                      {t.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Card 4: Top Commenters — Community Leaderboard — bottom right ── */}
          <div
            style={{
              position: 'absolute',
              bottom: 40,
              right: 56,
              transform: 'rotate(-4deg)',
              zIndex: 4,
              filter: 'drop-shadow(0 12px 36px rgba(0,0,0,0.11))',
            }}
          >
            {/* Folder tab */}
            <div
              style={{
                width: 100,
                height: 26,
                background: '#ebebea',
                borderRadius: '12px 12px 0 0',
              }}
            />

            {/* Gray outer */}
            <div
              style={{
                width: 274,
                background: '#ebebea',
                borderRadius: '0 0 20px 20px',
                padding: 8,
              }}
            >
              {/* White inner */}
              <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 14,
                  }}
                >
                  <p
                    style={{
                      fontSize: 15.5,
                      fontWeight: 700,
                      color: '#1a1a1a',
                      margin: 0,
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                    }}
                  >
                    Top Commenters
                  </p>
                  <span style={{ fontSize: 11, color: '#aaaaaa' }}>Leaderboard</span>
                </div>

                {TOP_COMMENTERS.map((c) => (
                  <div
                    key={c.rank}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: '#6c4cd6',
                        width: 16,
                        flexShrink: 0,
                        fontFamily: "'Plus Jakarta Sans',sans-serif",
                      }}
                    >
                      {c.rank}
                    </span>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        color: 'white',
                        background: c.platColor,
                        borderRadius: 4,
                        padding: '2px 5px',
                        flexShrink: 0,
                        fontFamily: "'Plus Jakarta Sans',sans-serif",
                      }}
                    >
                      {c.plat}
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: '#374151',
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.user}
                    </span>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: c.tierFg,
                        background: c.tierBg,
                        borderRadius: 100,
                        padding: '2px 7px',
                        flexShrink: 0,
                        fontFamily: "'Plus Jakarta Sans',sans-serif",
                      }}
                    >
                      {c.tier}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Center hero ── */}
          <div className="wp-center">
            <div className="wp-product-icon">
              {/* kepiai-mark.png is the complete mark cut from the official color
                  logo onto a square canvas with even padding. The older
                  kepiai-logo-icon.png had the capybara's rear clipped. */}
              <img
                src="/kepiai-mark.png"
                alt="Kepiai"
                style={{ width: 64, height: 64, objectFit: 'contain' }}
              />
            </div>

            <h1 className="wp-h1">The data is in.</h1>
            <h1 className="wp-h1-dim">The next move is yours.</h1>

            <p className="wp-subtitle">
              We&rsquo;ve organized your metrics, surfaced the insights, and prepared the reports.
              Now it&rsquo;s time to decide with confidence.
            </p>

            <div className="wp-cta-row">
              {hasOrgs ? (
                <button
                  className="wp-btn-main"
                  onClick={() => router.push(`/organizations/${firstOrgSlug}/dashboard`)}
                >
                  Explore Insights
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    arrow_forward
                  </span>
                </button>
              ) : (
                <button className="wp-btn-main" onClick={() => setShowCreate(true)}>
                  Get Started
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    arrow_forward
                  </span>
                </button>
              )}

              {invites.length > 0 && (
                <button className="wp-btn-ghost" onClick={() => setShowInvites(true)}>
                  <span className="wp-invite-dot">{invites.length}</span>
                  Invitations
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateOrgModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}
      {showInvites && (
        <InvitationsModal
          invites={invites}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onClose={() => setShowInvites(false)}
        />
      )}
    </>
  );
}
