import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CallsModule } from './calls/calls.module';
import { WebhookModule } from './webhook/webhook.module';
import { MangoModule } from './mango/mango.module';
import { S3Module } from './s3/s3.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    CallsModule,
    WebhookModule,
    MangoModule,
    S3Module,
    RealtimeModule,
  ],
})
export class AppModule {}



