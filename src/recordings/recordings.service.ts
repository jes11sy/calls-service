import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
  ) {}

  async getRecordingDownloadUrl(callId: number) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: {
        id: true,
        recordingPath: true,
      },
    });

    if (!call) {
      throw new NotFoundException('Call not found');
    }

    if (!call.recordingPath) {
      throw new NotFoundException('Recording not found for this call');
    }

    // Проверяем, что запись существует в S3
    const exists = await this.s3Service.checkFileExists(call.recordingPath);
    if (!exists) {
      this.logger.warn(`Recording file not found in S3: ${call.recordingPath}`);
      throw new NotFoundException('Recording file not found');
    }

    // Получаем подписанный URL (действителен 1 час)
    const signedUrl = await this.s3Service.getSignedUrl(call.recordingPath, 3600);

    this.logger.log(`Generated signed URL for call ${callId}`);

    return {
      success: true,
      url: signedUrl,
    };
  }
}

