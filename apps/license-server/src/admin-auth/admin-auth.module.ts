import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminJwtStrategy } from './admin-jwt.strategy';
import { AdminJwtGuard } from './admin-jwt.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('LICENSE_ADMIN_JWT_SECRET');
        if (!secret) throw new Error('LICENSE_ADMIN_JWT_SECRET is not set');
        return {
          secret,
          signOptions: { expiresIn: config.get<string>('LICENSE_ADMIN_JWT_EXPIRES_IN', '8h') },
        };
      },
    }),
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtStrategy, AdminJwtGuard],
  exports: [AdminJwtGuard],
})
export class AdminAuthModule {}
