import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Response } from 'express';

const SESSION_ERROR = 'Failed to get session';

// Translates Better Auth's internal "Failed to get session" into a clean 401.
// Everything else is delegated to Nest's default handler (BaseExceptionFilter) —
// NOT re-thrown from this global filter, which could leak a raw stack / 500.
@Catch()
export class AuthExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const msg = exception instanceof Error ? exception.message : '';
    if (msg === SESSION_ERROR) {
      host
        .switchToHttp()
        .getResponse<Response>()
        .status(401)
        .json({ statusCode: 401, message: 'Authentication required' });
      return;
    }
    super.catch(exception, host);
  }
}
