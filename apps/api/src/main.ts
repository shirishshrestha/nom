import { randomUUID } from 'node:crypto';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AuthExceptionFilter } from './common/auth-exception.filter';
import { AppLogger } from './common/app-logger';
import { requestContext } from './common/request-context';
import { trustedOrigins } from './common/trusted-origins';

async function bootstrap() {
  // bodyParser must be disabled so Better Auth can read the raw request body.
  // bufferLogs so early logs flush through AppLogger once it's registered.
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(new AppLogger());
  // Open a request-id context around every request so all logs within it correlate.
  app.use((_req, _res, next: () => void) =>
    requestContext.run({ requestId: randomUUID().slice(0, 8) }, next),
  );
  // WEB_URL is a comma-separated allowlist of origins; each request's Origin is
  // matched against it and echoed back (works with credentials, unlike '*').
  if (!process.env.WEB_URL)
    throw new Error(
      'WEB_URL must be set (CORS allowed origins, comma-separated)',
    );
  app.enableCors({
    origin: trustedOrigins(),
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AuthExceptionFilter(app.getHttpAdapter()));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('nom API')
    .setDescription('HTTP API for the nom service')
    .setVersion('0.0.1')
    // "Authorize" button: paste a session token (Better Auth bearer plugin).
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description: 'Better Auth session token',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // Apply the bearer scheme to every operation so Authorize unlocks them all.
  document.security = [{ bearer: [] }];
  // Swagger UI at /docs, raw spec at /docs-json
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 8000);
}
bootstrap().catch(console.error);
