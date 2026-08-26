import { Module } from '@nestjs/common';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// Wraps the Better Auth integration: forRoot mounts the /api/auth/* handler and
// registers the global AuthGuard (every route needs a session unless marked
// @AllowAnonymous()).
@Module({
  imports: [BetterAuthModule.forRoot({ auth })],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
