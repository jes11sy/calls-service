import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // ✅ FIX #86: Фильтрация уровней логов в production
  const logLevels: ('log' | 'error' | 'warn' | 'debug' | 'verbose')[] = isProduction
    ? ['log', 'error', 'warn']
    : ['log', 'error', 'warn', 'debug', 'verbose'];

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    {
      logger: logLevels, // ✅ FIX #86: Применяем фильтрацию логов
    },
  );

  const logger = new Logger('CallsService');

  // 🍪 РЕГИСТРАЦИЯ COOKIE PLUGIN (до CORS!)
  await app.register(require('@fastify/cookie'), {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET,
  });
  logger.log('✅ Cookie plugin registered');

  await app.register(require('@fastify/cors'), {
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Use-Cookies', // 🍪 Поддержка cookie mode
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(require('@fastify/helmet'), {
    contentSecurityPolicy: false,
  });

  app.useGlobalFilters(new HttpExceptionFilter());
  
  // 🔥 Error logging filter (5xx errors → error_logs table)
  const prismaService = app.get(PrismaService);
  app.useGlobalFilters(new GlobalExceptionFilter(prismaService));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Calls Service API')
    .setDescription('Calls management and Mango Office webhook integration')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 5003;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 Calls Service running on http://localhost:${port}`);
}

bootstrap();





















