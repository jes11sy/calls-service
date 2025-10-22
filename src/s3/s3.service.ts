import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly endpoint: string;

  constructor() {
    this.bucketName = process.env.S3_BUCKET_NAME || '';
    this.region = process.env.S3_REGION || 'us-east-1';
    this.endpoint = process.env.S3_ENDPOINT || '';

    const s3Config: any = {
      region: this.region,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    };

    // Если указан endpoint (например, для Selectel/MinIO)
    if (this.endpoint) {
      s3Config.endpoint = this.endpoint;
      s3Config.forcePathStyle = true;
    }

    this.s3Client = new S3Client(s3Config);

    if (!this.bucketName) {
      this.logger.warn('⚠️ S3_BUCKET_NAME not configured');
    } else {
      this.logger.log(`✅ S3 configured: ${this.bucketName}`);
    }
  }

  async uploadRecording(filename: string, buffer: Buffer): Promise<string> {
    try {
      const key = `callcentre/recordings/${filename}`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: 'audio/mpeg',
      });

      await this.s3Client.send(command);

      this.logger.log(`✅ Recording uploaded to S3: ${key}`);
      return key;
    } catch (error) {
      this.logger.error(`❌ Failed to upload recording to S3: ${error.message}`);
      throw error;
    }
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error) {
      this.logger.error(`Failed to generate signed URL: ${error.message}`);
      throw error;
    }
  }

  async checkFileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  isConfigured(): boolean {
    return !!this.bucketName;
  }
}

