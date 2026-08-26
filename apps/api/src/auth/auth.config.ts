// Standalone Better Auth instance.
//
// Loaded at import time (before Nest's ConfigModule runs), so we load .env here
// ourselves. The Better Auth CLI is pointed at this file via --config:
//   pnpm --filter api auth:generate   # write schema
//   pnpm --filter api auth:migrate    # apply to Postgres
//
// BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from the environment
// automatically by Better Auth.
import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { bearer, organization } from 'better-auth/plugins';
import { Pool } from 'pg';
import { trustedOrigins } from '../common/trusted-origins';

// Cross-site (local frontend → cloud https backend) needs SameSite=None; Secure
// for the session cookie to be sent at all — and Secure requires https. Over
// https we turn both on (plus the matching __Secure- prefix); pure-local http
// can't use Secure, so we fall back to lax there.
const secureCookies =
  process.env.BETTER_AUTH_URL?.startsWith('https://') ?? false;

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  advanced: {
    useSecureCookies: secureCookies,
    defaultCookieAttributes: {
      sameSite: secureCookies ? 'none' : 'lax',
      secure: secureCookies,
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: trustedOrigins(),
  // Multi-tenancy: organizations are tenants. Users can belong to many orgs
  // (member table) and switch the active one (session.activeOrganizationId).
  // bearer: accept the session token as `Authorization: Bearer <token>` so the
  // Swagger "Authorize" button can drive protected endpoints (cookie still works).
  plugins: [organization({ teams: { enabled: true } }), bearer()],
});
