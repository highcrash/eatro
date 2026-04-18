import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';

/**
 * License server bootstrap.
 *
 * Design notes:
 *  - Trust proxy is on — this sits behind DO App Platform (and possibly CF)
 *    so req.ip needs to walk X-Forwarded-For to reach the real client.
 *    The public endpoints use req.ip for rate-limit keys + CheckLog rows.
 *  - CORS is locked to LICENSE_ADMIN_ORIGIN only. The public API is called
 *    by buyers' installed servers/browsers from arbitrary origins, so for
 *    /api/v1/licenses/* CORS is effectively wildcard (handled in the
 *    public controller with a per-route decorator rather than globally).
 *  - No static assets — this service serves JSON only.
 *  - Port 3002 by default (3001 is the main app API).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3002);
  const adminOrigin = config.get<string>('LICENSE_ADMIN_ORIGIN', 'http://localhost:5178');

  app.set('trust proxy', true);

  app.useBodyParser('json', { limit: '1mb' });

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // CORS: admin-UI origin gets credentialed access to /admin/*. The public
  // /licenses/* routes need to be reachable from anywhere and will set
  // `Access-Control-Allow-Origin: *` via route-level middleware.
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / server-to-server
      if (origin === adminOrigin) return cb(null, true);
      // Public license API: any origin, but NO credentials.
      return cb(null, true);
    },
    credentials: true,
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('License Server API')
      .setDescription('Self-hosted license server for CodeCanyon products')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🔑 License server running on http://localhost:${port}/api`);
}

void bootstrap();
