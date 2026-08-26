import { Controller } from '@nestjs/common';

// Auth HTTP routes (sign-in/up, organization, etc.) are served by Better Auth
// at /api/auth/*. This controller is a placeholder for future custom endpoints
// (e.g. GET /me returning the session + active org). Intentionally no routes.
@Controller('auth')
export class AuthController {}
