import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ExternalApiModule } from './external-api/external-api.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);
  const clientOrigins = config
    .get<string>('CORS_ORIGINS', 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:5177')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Behind CloudFlare → DO App Platform there are 2+ proxy hops, so trust
  // the whole chain. `true` tells Express to honor X-Forwarded-For from
  // every upstream and set req.ip to the original client. Individual
  // middleware (like the QR gate) additionally prefers CF-Connecting-IP
  // and X-Forwarded-For[0] to be fully explicit.
  app.set('trust proxy', true);

  // Serve locally-uploaded files for dev. In production uploads go to DO Spaces.
  app.useStaticAssets(join(process.cwd(), 'apps', 'api', 'uploads'), { prefix: '/uploads/' });

  // Body size limits
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '50mb' });

  // Security
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: clientOrigins,
    credentials: true,
  });

  // Versioning
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api');

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger (dev only)
  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Restora POS API')
      .setDescription('Restaurant Management Software — REST API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);

    // Separate doc scoped to the External API — the contract for AI /
    // marketing / data consumers. Hides the staff-internal surface.
    const externalConfig = new DocumentBuilder()
      .setTitle('Restora External API — v1')
      .setDescription(
        'Programmatic, scope-gated, branch-scoped read access for AI Marketing Agent and other external consumers. ' +
          'Authenticate with `Authorization: Bearer rk_<prefix>_<secret>`. Keys are minted from Restora Admin → Integrations (OWNER only).',
      )
      .setVersion('1.0')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'rk_<prefix>_<secret>',
        description: 'External API key. Format: rk_<8-hex-prefix>_<base64url-secret>',
      })
      .build();
    const externalDoc = SwaggerModule.createDocument(app, externalConfig, {
      include: [ExternalApiModule],
    });
    SwaggerModule.setup('api/docs/external', app, externalDoc);
  }

  await app.listen(port);
  console.warn(`🚀 Restora API running on http://localhost:${port}/api`);
  console.warn(`📚 Swagger docs: http://localhost:${port}/api/docs`);
  console.warn(`📡 External API docs: http://localhost:${port}/api/docs/external`);
}

void bootstrap();
