import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';

// One line per request in / response out, with duration and status. The request id
// is added by AppLogger. Never logs bodies — method/path/status/duration only.
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const { method } = req;
    const url = req.originalUrl;
    // Swagger UI polls its own assets; skip to keep the log readable.
    if (url.startsWith('/docs')) return next.handle();

    const start = Date.now();
    this.logger.log(`→ ${method} ${url}`);

    return next.handle().pipe(
      tap({
        next: () => {
          const status = context
            .switchToHttp()
            .getResponse<Response>().statusCode;
          this.logger.log(
            `← ${method} ${url} ${status} +${Date.now() - start}ms`,
          );
        },
        error: (err: unknown) => {
          const status = err instanceof HttpException ? err.getStatus() : 500;
          const message = err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(
            `✖ ${method} ${url} ${status} +${Date.now() - start}ms: ${message}`,
          );
        },
      }),
    );
  }
}
