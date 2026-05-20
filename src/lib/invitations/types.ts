export interface Invitation {
  id: string
  org_id: string
  org_slug: string
  org_name: string
  invited_by: string | null
  invited_at: string
  member_count: number
}
