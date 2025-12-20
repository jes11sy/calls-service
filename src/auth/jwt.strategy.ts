import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  
  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    
    // Логируем информацию о секрете при старте
    console.log(`[JwtStrategy] 🔐 JWT_SECRET configured:`);
    console.log(`[JwtStrategy]    - Length: ${secret.length} chars`);
    console.log(`[JwtStrategy]    - Starts with: ${secret.substring(0, 15)}...`);
    console.log(`[JwtStrategy]    - Ends with: ...${secret.substring(secret.length - 10)}`);
    
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    this.logger.debug(`✅ JWT validated successfully for user: ${payload.sub}`);
    return {
      userId: payload.sub,
      login: payload.login,
      role: payload.role,
    };
  }
}





















