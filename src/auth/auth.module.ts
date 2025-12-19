import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { CookieJwtAuthGuard } from './guards/cookie-jwt-auth.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: (() => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        if (secret === 'your-secret-key') {
          throw new Error('JWT_SECRET must be changed from default value');
        }
        return secret;
      })(),
      signOptions: { expiresIn: '1h' },
    }),
  ],
  providers: [JwtStrategy, RolesGuard, CookieJwtAuthGuard],
  exports: [JwtModule, RolesGuard, CookieJwtAuthGuard],
})
export class AuthModule {}





















