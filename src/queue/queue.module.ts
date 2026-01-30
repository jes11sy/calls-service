import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RecordingProcessor } from './recording.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { MangoModule } from '../mango/mango.module';
import { S3Module } from '../s3/s3.module';
import { RealtimeModule } from '../realtime/realtime.module';

export const RECORDING_QUEUE = 'recording-download';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    BullModule.registerQueue({
      name: RECORDING_QUEUE,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 10000, // 10 секунд, потом 20, 40, 80, 160
        },
        removeOnComplete: 100, // Храним последние 100 успешных
        removeOnFail: 500,     // Храним последние 500 failed для анализа
      },
    }),
    PrismaModule,
    MangoModule,
    S3Module,
    RealtimeModule,
  ],
  providers: [RecordingProcessor],
  exports: [BullModule],
})
export class QueueModule {}
