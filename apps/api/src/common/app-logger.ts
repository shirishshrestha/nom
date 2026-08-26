import { ConsoleLogger } from '@nestjs/common';
import { requestContext } from './request-context';

// Prefixes every log line with the current request id (from AsyncLocalStorage) so
// the HTTP envelope and all service/repo logs within one request correlate. Startup
// logs (no request context) are left unprefixed. Registered via app.useLogger(), so
// all `new Logger(context)` instances route through it.
export class AppLogger extends ConsoleLogger {
  private tag(message: unknown): unknown {
    const id = requestContext.getStore()?.requestId;
    return id && typeof message === 'string' ? `[${id}] ${message}` : message;
  }

  log(message: unknown, ...rest: unknown[]): void {
    super.log(this.tag(message), ...(rest as [string?]));
  }

  error(message: unknown, ...rest: unknown[]): void {
    super.error(this.tag(message), ...(rest as [string?, string?]));
  }

  warn(message: unknown, ...rest: unknown[]): void {
    super.warn(this.tag(message), ...(rest as [string?]));
  }

  debug(message: unknown, ...rest: unknown[]): void {
    super.debug(this.tag(message), ...(rest as [string?]));
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(this.tag(message), ...(rest as [string?]));
  }
}
