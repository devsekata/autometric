export function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const code = Math.random().toString(36).slice(2, 8)
  return base ? `${base}-${code}` : code
}
