import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    // ✅ ОПТИМИЗИРОВАНО: Calls Service - средняя/высокая нагрузка
    // Обрабатывает входящие звонки, записи разговоров, статусы
    const databaseUrl = process.env.DATABASE_URL || '';
    const hasParams = databaseUrl.includes('?');
    
    const connectionParams = [
      'connection_limit=35',      // Средне-высокое значение для звонков
      'pool_timeout=20',          // Таймаут получения соединения: 20s
      'connect_timeout=10',       // Таймаут подключения к БД: 10s
      'socket_timeout=60',        // Таймаут socket: 60s
    ];
    
    const needsParams = !databaseUrl.includes('connection_limit');
    const enhancedUrl = needsParams
      ? `${databaseUrl}${hasParams ? '&' : '?'}${connectionParams.join('&')}`
      : databaseUrl;

    super({
      datasources: {
        db: {
          url: enhancedUrl,
        },
      },
      log: isDevelopment 
        ? ['warn', 'error']
        : ['error'],
    });

    if (needsParams) {
      this.logger.log('✅ Connection pool configured: limit=35, pool_timeout=20s');
    }

    // Query Performance Monitoring
    this.$use(async (params, next) => {
      const before = Date.now();
      
      try {
        const result = await next(params);
        const duration = Date.now() - before;

        if (duration > 1000) {
          this.logger.error(`🐌 SLOW QUERY: ${params.model}.${params.action} took ${duration}ms`);
        } else if (duration > 500) {
          this.logger.warn(`⚠️ Slow query: ${params.model}.${params.action} took ${duration}ms`);
        }

        return result;
      } catch (error) {
        const duration = Date.now() - before;
        this.logger.error(`❌ Query failed after ${duration}ms`, error);
        throw error;
      }
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('✅ Database connected successfully');
      this.logger.log('✅ Calls Service ready');
    } catch (error) {
      this.logger.error('❌ Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('✅ Database disconnected');
  }
}





















