/**
 * Reading a creator handle out of whatever the user pasted.
 *
 * Client-safe on purpose, like `vocab.ts` and for the same reason: the Add
 * Account modal validates as you type, so this file must not import the pg pool
 * or the Apify client. Everything here is string work — no network, no database.
 *
 * The modal accepts two shapes for one reason: people copy a profile URL far
 * more often than they type a handle, and a URL carries its platform with it,
 * so pasting the wrong platform's link is a mistake this layer can catch before
 * anything is spent on checking it.
 */

export type CreatorPlatform = 'instagram' | 'tiktok' | 'facebook'

export interface CreatorPlatformDef {
  id: CreatorPlatform
  label: string
  icon: string
  /** Hosts whose links belong to this platform, without `www.`. */
  hosts: string[]
  /** Shown under the username field. */
  handleExample: string
  urlExample: string
  /**
   * What the platform lets a handle contain — and, more to the point, what the
   * Apify actor for it accepts. A handle with a space does not merely fail to
   * resolve: it makes the actor refuse to start (see `@/lib/competitors/verify`,
   * which owns the same rule for competitor accounts).
   */
  handle: RegExp
}

export const CREATOR_PLATFORMS: CreatorPlatformDef[] = [
  {
    id: 'instagram', label: 'Instagram', icon: 'photo_camera',
    hosts: ['instagram.com', 'instagr.am'],
    handleExample: '@raditya_dika',
    urlExample: 'https://instagram.com/raditya_dika',
    handle: /^[A-Za-z0-9._]{1,30}$/,
  },
  {
    id: 'tiktok', label: 'TikTok', icon: 'music_note',
    hosts: ['tiktok.com', 'vt.tiktok.com'],
    handleExample: '@radityadika',
    urlExample: 'https://tiktok.com/@radityadika',
    handle: /^[A-Za-z0-9._]{1,24}$/,
  },
  {
    id: 'facebook', label: 'Facebook', icon: 'thumb_up',
    hosts: ['facebook.com', 'fb.com', 'm.facebook.com', 'web.facebook.com'],
    handleExample: 'RadityaDika',
    urlExample: 'https://facebook.com/RadityaDika',
    // Facebook vanity URLs carry hyphens; Instagram and TikTok handles do not.
    handle: /^[A-Za-z0-9._-]{1,100}$/,
  },
]

export const platformDef = (id: string): CreatorPlatformDef | undefined =>
  CREATOR_PLATFORMS.find(p => p.id === id)

export const platformLabel = (id: string): string => platformDef(id)?.label ?? id

/**
 * Path segments that are pages rather than people.
 *
 * `instagram.com/p/Cxyz` is a post, not a profile, and taking `p` as the handle
 * would send a valid-looking request off to check an account that cannot exist.
 * Rejecting it here says the true thing — that link is not a profile link —
 * instead of reporting "account not found" a minute later.
 */
const NOT_A_PROFILE: Record<CreatorPlatform, Set<string>> = {
  instagram: new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about']),
  tiktok: new Set(['video', 'tag', 'music', 'discover', 'foryou', 'live', 'search', 'upload']),
  facebook: new Set(['watch', 'groups', 'pages', 'marketplace', 'events', 'story.php', 'sharer.php', 'photo.php', 'permalink.php']),
}

export type InputProblem = 'empty' | 'invalid_url' | 'wrong_platform' | 'not_a_profile' | 'invalid_handle'

export type CreatorInput =
  | { ok: true; platform: CreatorPlatform; username: string; profileUrl: string; from: 'url' | 'handle' }
  | { ok: false; problem: InputProblem; message: string; suggestPlatform?: CreatorPlatform }

/** The canonical public profile link for a handle. */
export function profileUrlFor(platform: string, username: string): string {
  const clean = username.replace(/^@/, '')
  if (platform === 'tiktok') return `https://www.tiktok.com/@${clean}`
  if (platform === 'facebook') {
    return /^\d{5,}$/.test(clean)
      ? `https://www.facebook.com/profile.php?id=${clean}`
      : `https://www.facebook.com/${clean}`
  }
  return `https://www.instagram.com/${clean}`
}

/** Looks like a link rather than a handle — the two are told apart before parsing. */
function looksLikeUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw)
    || /^[\w.-]+\.[a-z]{2,}\//i.test(raw)
    || /^(www\.)?[\w-]+\.[a-z]{2,}$/i.test(raw)
}

/**
 * Which platform a pasted link belongs to, by host — null when it is not a link,
 * or not a host we know.
 *
 * Add New KOL uses this when it arrives seeded with a link (`?url=`), so a
 * pasted TikTok URL does not land under Instagram and greet the user with a
 * wrong-platform error they did nothing to earn.
 */
export function platformOfUrl(raw: string): CreatorPlatform | null {
  const value = (raw ?? '').trim()
  if (!looksLikeUrl(value)) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  return CREATOR_PLATFORMS.find(p => p.hosts.includes(host))?.id ?? null
}

/**
 * Turn one input into a `(platform, username)` pair, or say why it cannot be.
 *
 * The failure cases are distinguished rather than collapsed into "invalid",
 * because the flow shows a different screen for each and the user's next move
 * differs: a TikTok link pasted under Instagram is fixed by switching platform,
 * a post link is fixed by opening the creator's profile first, and a typo in a
 * handle is fixed in place.
 */
export function parseCreatorInput(platform: string, raw: string): CreatorInput {
  const def = platformDef(platform)
  if (!def) return { ok: false, problem: 'invalid_url', message: `Platform "${platform}" is not supported yet.` }

  const value = (raw ?? '').trim()
  if (!value) {
    return { ok: false, problem: 'empty', message: 'Enter a username or a profile URL first.' }
  }

  if (looksLikeUrl(value)) return fromUrl(def, value)

  const username = value.replace(/^@/, '').replace(/\/+$/, '')
  if (!def.handle.test(username)) {
    const allowed = def.id === 'facebook'
      ? 'letters, numbers, dots, underscores and hyphens'
      : 'letters, numbers, dots and underscores'
    return {
      ok: false, problem: 'invalid_handle',
      message: `"${value}" is not a valid ${def.label} username — ${allowed} only, with no spaces.`,
    }
  }
  return { ok: true, platform: def.id, username, profileUrl: profileUrlFor(def.id, username), from: 'handle' }
}

function fromUrl(def: CreatorPlatformDef, value: string): CreatorInput {
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    return {
      ok: false, problem: 'invalid_url',
      message: 'That does not look like a URL. Paste the full profile link, or type the username instead.',
    }
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!def.hosts.includes(host)) {
    // Naming the platform the link actually belongs to turns a dead end into a
    // one-click fix, and the modal offers exactly that.
    const actual = CREATOR_PLATFORMS.find(p => p.hosts.includes(host))
    return {
      ok: false, problem: 'wrong_platform',
      suggestPlatform: actual?.id,
      message: actual
        ? `This is a ${actual.label} link but ${def.label} is selected. Switch the platform, or paste a URL from ${def.label}.`
        : `${url.hostname} is not a ${def.label} address. Paste a link from ${def.urlExample}.`,
    }
  }

  const segments = url.pathname.split('/').map(s => s.trim()).filter(Boolean)

  // `facebook.com/profile.php?id=100064…` is how Facebook links an account with
  // no vanity name. The numeric id is the handle in that case — the Apify actor
  // resolves it the same way it resolves a vanity path.
  if (def.id === 'facebook' && segments[0]?.toLowerCase() === 'profile.php') {
    const id = url.searchParams.get('id')?.trim()
    if (id && /^\d{5,}$/.test(id)) {
      return { ok: true, platform: def.id, username: id, profileUrl: profileUrlFor('facebook', id), from: 'url' }
    }
    return {
      ok: false, problem: 'invalid_url',
      message: 'That Facebook link carries no account id. Open the profile and copy the address from the browser bar.',
    }
  }

  const first = segments[0]
  if (!first) {
    return {
      ok: false, problem: 'invalid_url',
      message: `That is the ${def.label} home page, not a profile. Open the creator's profile and copy its address.`,
    }
  }
  if (NOT_A_PROFILE[def.id].has(first.toLowerCase())) {
    return {
      ok: false, problem: 'not_a_profile',
      message: `That link points to a post or a section of ${def.label}, not a profile. Open the creator's profile and copy the address from there.`,
    }
  }

  const username = first.replace(/^@/, '')
  if (!def.handle.test(username)) {
    return {
      ok: false, problem: 'invalid_url',
      message: `"${username}" is not a valid ${def.label} username. Check the link and try again.`,
    }
  }
  return { ok: true, platform: def.id, username, profileUrl: profileUrlFor(def.id, username), from: 'url' }
}
