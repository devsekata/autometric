import OrgCard from './OrgCard'
import { Organization } from '@/lib/organizations/types'

interface Props {
  orgs: Organization[]
}

export default function OrgList({ orgs }: Props) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
      {orgs.map(org => (
        <OrgCard key={org.id} org={org} />
      ))}
    </div>
  )
}
