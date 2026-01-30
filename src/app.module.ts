import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CallsModule } from './calls/calls.module';
import { WebhookModule } from './webhook/webhook.module';
import { MangoModule } from './mango/mango.module';
import { S3Module } from './s3/s3.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RecordingsModule } from './recordings/recordings.module';
import { PhonesModule } from './phones/phones.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // ✅ FIX #159: Rate limiting для защиты от DDoS и брутфорса
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,   // 1 секунда
        limit: 10,   // 10 запросов в секунду
      },
      {
        name: 'medium',
        ttl: 10000,  // 10 секунд
        limit: 50,   // 50 запросов за 10 секунд
      },
      {
        name: 'long',
        ttl: 60000,  // 1 минута
        limit: 200,  // 200 запросов в минуту
      },
    ]),
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      path: '/metrics',
    }),
    PrismaModule,
    AuthModule,
    CallsModule,
    WebhookModule,
    MangoModule,
    S3Module,
    RealtimeModule,
    RecordingsModule,
    PhonesModule,
    QueueModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}



