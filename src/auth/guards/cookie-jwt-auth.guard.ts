import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CookieConfig } from '../../config/cookie.config';
import { FastifyRequest } from 'fastify';

/**
 * 🍪 COOKIE JWT AUTH GUARD
 * 
 * Guard для извлечения JWT токенов из httpOnly cookies
 * Если токен найден в cookie, он добавляется в Authorization header
 * для дальнейшей обработки стандартным JwtStrategy
 */
@Injectable()
export class CookieJwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(CookieJwtAuthGuard.name);

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    
    // Пытаемся получить токен из cookies
    let cookieToken: string | null = null;
    
    // Проверяем наличие cookies в request (NestJS abstraction)
    const cookiesSource = (request as any).cookies || (request.raw as any)?.cookies || null;
    const unsignCookieFn = (request as any).unsignCookie || (request.raw as any)?.unsignCookie || null;
    
    if (cookiesSource) {
      const rawCookie = cookiesSource[CookieConfig.ACCESS_TOKEN_NAME];
      if (rawCookie) {
        // Проверяем: если cookie начинается с 's:' - это подписанный cookie Fastify
        // Иначе - это неподписанный JWT токен
        if (rawCookie.startsWith('s:') && CookieConfig.ENABLE_COOKIE_SIGNING && unsignCookieFn) {
          // Подписанный cookie - проверяем подпись
          const unsigned = unsignCookieFn(rawCookie);
          if (unsigned?.valid) {
            cookieToken = unsigned.value;
          } else {
            this.logger.warn('⚠️ Invalid access token signature. Possible tampering.');
            throw new UnauthorizedException('Invalid cookie signature detected. Possible tampering attempt.');
          }
        } else {
          // Неподписанный cookie (обычный JWT) - используем напрямую
          cookieToken = rawCookie;
        }
      }
    }
    
    // Если токен найден в cookie и нет Authorization header, добавляем его
    if (cookieToken && !request.headers.authorization) {
      // Очищаем токен от возможных префиксов подписи Fastify (s:...)
      const cleanToken = cookieToken.startsWith('s:') ? cookieToken.substring(2) : cookieToken;
      request.headers.authorization = `Bearer ${cleanToken}`;
      this.logger.debug(`✅ Token extracted from cookie: ${cleanToken.substring(0, 50)}...`);
    }
    
    // Вызываем стандартную JWT валидацию
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Access token has expired. Please refresh your token.');
      }
      if (info?.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid access token.');
      }
      throw err || new UnauthorizedException('Authentication required.');
    }
    return user;
  }
}

