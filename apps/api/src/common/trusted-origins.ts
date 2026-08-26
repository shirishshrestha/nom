// Allowed CORS / Better Auth origins: the WEB_URL comma-separated allowlist
// plus local dev origins. Shared by main.ts (CORS) and auth.config.ts.
export function trustedOrigins(): string[] {
  return [
    ...(process.env.WEB_URL?.split(',').map((o) => o.trim()) ?? []),
    'http://localhost:5173',
    'http://localhost:3000',
    'https://localhost:3000',
  ];
}
