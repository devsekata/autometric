/**
 * Switched off with the Brands module: this layout loaded the brand from the
 * analytics warehouse. The pages under it now only show an "unavailable"
 * notice, and each checks organization membership itself.
 */
export default function BrandDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
