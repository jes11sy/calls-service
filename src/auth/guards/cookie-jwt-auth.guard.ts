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
 * 
 * ⚠️ ВАЖНО: Fastify подписывает cookies в формате "value.signature"
 * (не "s:value" как в Express!)
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
    const unsignCookieFn = (request as any).unsignCookie?.bind(request) || null;
    
    if (cookiesSource) {
      const rawCookie = cookiesSource[CookieConfig.ACCESS_TOKEN_NAME];
      
      this.logger.debug(`🔍 Raw cookie value: ${rawCookie ? rawCookie.substring(0, 80) + '...' : 'null'}`);
      
      if (rawCookie) {
        // ✅ Fastify @fastify/cookie: подписанные cookies имеют формат "value.signature"
        // Используем unsignCookie для проверки подписи
        if (CookieConfig.ENABLE_COOKIE_SIGNING && unsignCookieFn) {
          try {
            const unsigned = unsignCookieFn(rawCookie);
            this.logger.debug(`🔓 Unsign result: valid=${unsigned?.valid}, renew=${unsigned?.renew}, value=${unsigned?.value?.substring(0, 50)}...`);
            
            if (unsigned?.valid) {
              // Подпись валидна - используем значение
              cookieToken = unsigned.value;
            } else if (unsigned?.value) {
              // Подпись невалидна, но есть значение - возможно cookie не подписан
              // Проверяем, похоже ли это на JWT (начинается с eyJ)
              if (rawCookie.startsWith('eyJ')) {
                this.logger.debug('📝 Cookie looks like unsigned JWT, using raw value');
                cookieToken = rawCookie;
              } else {
                this.logger.warn('⚠️ Invalid cookie signature and not a valid JWT format');
                throw new UnauthorizedException('Invalid cookie signature detected.');
              }
            } else {
              // Fallback: если unsignCookie вернул пустой результат, пробуем использовать raw
              if (rawCookie.startsWith('eyJ')) {
                this.logger.debug('📝 Fallback: using raw cookie as JWT');
                cookieToken = rawCookie;
              }
            }
          } catch (err) {
            this.logger.error(`❌ Error unsigning cookie: ${err.message}`);
            // Fallback для неподписанных cookies
            if (rawCookie.startsWith('eyJ')) {
              cookieToken = rawCookie;
            }
          }
        } else {
          // Cookie signing отключён - используем напрямую
          cookieToken = rawCookie;
        }
      }
    }
    
    // Если токен найден в cookie и нет Authorization header, добавляем его
    if (cookieToken && !request.headers.authorization) {
      this.logger.debug(`✅ Token extracted from cookie: ${cookieToken.substring(0, 50)}...`);
      request.headers.authorization = `Bearer ${cookieToken}`;
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

