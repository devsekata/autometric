/**
 * `npm run seed:admin` — switched off.
 *
 * This seeder used to create an application admin in the analytics warehouse's
 * `users` table. Accounts for the KOL product live in the KOL database
 * (`public."user"`, `agencies`, `agency_members`), which is a shared server, so
 * nothing here writes a hard-coded development account into it either. Create
 * admin accounts on the KOL server deliberately, through the owner.
 */
console.error(
  'seed:admin is disabled: users live in the KOL database (public."user"). ' +
  'Create admin accounts there deliberately; this script no longer writes any database.',
)
process.exit(1)

export {}
