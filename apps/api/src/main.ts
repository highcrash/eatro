import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';

import { AppModule } from './app.module';

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
      .setTitle('Your Restaurant POS API')
      .setDescription('Restaurant Management Software — REST API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
  console.warn(`🚀 Your Restaurant API running on http://localhost:${port}/api`);
  console.warn(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}

void bootstrap();
