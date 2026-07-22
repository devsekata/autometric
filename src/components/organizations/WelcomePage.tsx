'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import WelcomeNavbar from '@/components/layout/WelcomeNavbar';
import CreateOrgModal from './CreateOrgModal';
import InvitationsModal from '@/components/invitations/InvitationsModal';
import { Organization } from '@/lib/organizations/types';
import { Invitation } from '@/lib/invitations/types';

const BAR_HEIGHTS = [28, 44, 36, 54, 40, 62, 50, 68, 56, 82, 66, 78];

const PERF_BRANDS = [
  { name: 'Kepiai HQ', score: 92, pct: 92, color: '#1B8A80', trend: '↑' },
  { name: 'Brand Studio', score: 87, pct: 87, color: '#7c5cbf', trend: '→' },
  { name: 'Research Team', score: 79, pct: 79, color: '#059669', trend: '↑' },
  { name: 'Growth Labs', score: 74, pct: 74, color: '#d97706', trend: '↓' },
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

        .wp-h1 {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 82px;
          font-weight: 800;
          line-height: 1.0;
          letter-spacing: -0.04em;
          margin: 0;
          color: #111111;
        }

        .wp-h1-dim {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 82px;
          font-weight: 800;
          line-height: 1.0;
          letter-spacing: -0.04em;
          margin: 0 0 24px;
          color: #c2c2c0;
        }

        .wp-subtitle {
          font-size: 16px;
          color: #6b7280;
          line-height: 1.65;
          max-width: 420px;
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
          background: #1B8A80;
          color: white;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 15.5px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.15s;
          box-shadow: 0 4px 20px rgba(61,126,150,0.38);
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
          background: #1B8A80;
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
          {/* ── Card 1: Brand Score — top left, folder tab shape ── */}
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
                    alignItems: 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  <p
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      color: '#1a1a1a',
                      margin: 0,
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                    }}
                  >
                    Brand Score
                  </p>
                  <span style={{ fontSize: 11, color: '#aaaaaa', marginTop: 2 }}>This Quarter</span>
                </div>

                <p
                  style={{
                    fontSize: 42,
                    fontWeight: 800,
                    color: '#111827',
                    lineHeight: 1,
                    fontFamily: "'Plus Jakarta Sans',sans-serif",
                    margin: '8px 0 8px',
                  }}
                >
                  92.4
                </p>

                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#16a34a',
                    background: '#dcfce7',
                    padding: '3px 10px',
                    borderRadius: 100,
                    marginBottom: 16,
                  }}
                >
                  ↑ 12%
                </span>

                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 36 }}>
                  {BAR_HEIGHTS.map((h, i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        borderRadius: '3px 3px 0 0',
                        height: `${h}%`,
                        background: i >= 9 ? '#1B8A80' : 'rgba(0,0,0,0.08)',
                      }}
                    />
                  ))}
                </div>
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

          {/* ── Card 3: Performance — bottom left, folder tab, tall ── */}
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
                width: 252,
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
                    marginBottom: 16,
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
                    Performance
                  </p>
                  <span style={{ fontSize: 11, color: '#aaaaaa' }}>This Month</span>
                </div>

                {PERF_BRANDS.map((b) => (
                  <div key={b.name} style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: b.color,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: 12.5, color: '#374151' }}>{b.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
                          {b.score}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color:
                              b.trend === '↑' ? '#16a34a' : b.trend === '↓' ? '#dc2626' : '#9ca3af',
                          }}
                        >
                          {b.trend}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: 'rgba(0,0,0,0.07)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${b.pct}%`,
                          height: '100%',
                          background: b.color,
                          borderRadius: 4,
                          opacity: 0.65,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Center hero ── */}
          <div className="wp-center">
            <div className="wp-product-icon">
              <img
                src="/kepiai-logo-icon.png"
                alt="Kepiai"
                style={{ width: 48, height: 48, objectFit: 'contain' }}
              />
            </div>

            <h1 className="wp-h1">Track every brand.</h1>
            <h1 className="wp-h1-dim">Beat every rival.</h1>

            <p className="wp-subtitle">
              Monitor brand performance, analyze competitors, and collaborate with your team — all
              in one platform.
            </p>

            <div className="wp-cta-row">
              {hasOrgs ? (
                <button
                  className="wp-btn-main"
                  onClick={() => router.push(`/organizations/${firstOrgSlug}/dashboard`)}
                >
                  Go to Dashboard
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
