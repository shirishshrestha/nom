import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { auth } from './auth.config.js';

// The session shape, inferred from the auth config (includes user + the org
// plugin's activeOrganizationId / activeTeamId). Use in controllers:
//   getMe(@Session() session: Session) { ... }
export type Session = UserSession<typeof auth>;

// Narrowed session guaranteed to have an active org — use with @OrgSession().
export type OrgSession = Session & {
  session: { activeOrganizationId: string };
};

// Re-export the organization model types for convenience.
export type {
  Invitation,
  Member,
  Organization,
  Team,
} from 'better-auth/plugins/organization';
