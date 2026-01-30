import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MangoService } from '../mango/mango.service';
import { S3Service } from '../s3/s3.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RECORDING_QUEUE } from './constants';

export interface RecordingJobData {
  callId: number;
  callIdMango: string;
  recordingId: string;
}

@Processor(RECORDING_QUEUE)
export class RecordingProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordingProcessor.name);

  constructor(
    private prisma: PrismaService,
    private mangoService: MangoService,
    private s3Service: S3Service,
    private realtimeService: RealtimeService,
  ) {
    super();
  }

  async process(job: Job<RecordingJobData>): Promise<void> {
    const { callId, callIdMango, recordingId } = job.data;

    this.logger.log(
      `📥 Processing recording job ${job.id}: call=${callId}, recording=${recordingId}, attempt=${job.attemptsMade + 1}/${job.opts.attempts}`
    );

    // Проверяем что звонок существует
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
    });

    if (!call) {
      this.logger.warn(`Call ${callId} not found, skipping recording download`);
      return; // Не retry — звонок удалён
    }

    // Уже скачана?
    if (call.recordingPath) {
      this.logger.log(`Recording already downloaded for call ${callId}, skipping`);
      return;
    }

    // Проверяем конфигурацию
    if (!this.mangoService.isConfigured()) {
      throw new Error('Mango API not configured');
    }

    if (!this.s3Service.isConfigured()) {
      throw new Error('S3 not configured');
    }

    // Скачиваем запись из Mango
    const buffer = await this.mangoService.downloadRecording(recordingId);

    if (!buffer || buffer.length === 0) {
      throw new Error('Empty recording received from Mango');
    }

    this.logger.log(`Downloaded ${buffer.length} bytes from Mango`);

    // Загружаем в S3
    const filename = `${callIdMango}_${Date.now()}.mp3`;
    const s3Key = await this.s3Service.uploadRecording(filename, buffer);

    // Обновляем звонок
    const updatedCall = await this.prisma.call.update({
      where: { id: callId },
      data: {
        recordingPath: s3Key,
        recordingProcessedAt: new Date(),
      },
      include: {
        operator: {
          select: { id: true, name: true },
        },
      },
    });

    this.logger.log(`✅ Recording uploaded to S3: ${s3Key}`);

    // Broadcast обновления
    await this.realtimeService.broadcastCallUpdated(updatedCall, ['operators']);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<RecordingJobData>) {
    this.logger.log(`✅ Job ${job.id} completed for call ${job.data.callId}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<RecordingJobData>, error: Error) {
    this.logger.error(
      `❌ Job ${job.id} failed for call ${job.data.callId}: ${error.message}`,
      error.stack
    );

    // Если все попытки исчерпаны — сохраняем failed_recording_id
    if (job.attemptsMade >= (job.opts.attempts || 5) - 1) {
      this.logger.error(
        `❌ All attempts exhausted for call ${job.data.callId}, recording ${job.data.recordingId}`
      );
      this.markRecordingFailed(job.data);
    }
  }

  private async markRecordingFailed(data: RecordingJobData) {
    try {
      const call = await this.prisma.call.findUnique({
        where: { id: data.callId },
      });

      if (call) {
        await this.prisma.call.update({
          where: { id: data.callId },
          data: {
            mangoData: {
              ...(typeof call.mangoData === 'object' ? call.mangoData : {}),
              failed_recording_id: data.recordingId,
              recording_download_failed_at: new Date().toISOString(),
            },
          },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to mark recording as failed: ${error.message}`);
    }
  }
}
