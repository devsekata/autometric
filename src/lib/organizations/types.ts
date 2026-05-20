export interface Organization {
  id: string
  slug: string
  name: string
  created_at: string
  role: 'ADMIN' | 'MEMBER'
  member_count: number
  brand_count: number
  members_preview: { name: string }[]
}
