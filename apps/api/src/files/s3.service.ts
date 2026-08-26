import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.client = new S3Client({ region: config.getOrThrow('AWS_REGION') });
    this.bucket = config.getOrThrow('S3_BUCKET_NAME');
  }

  getPresignedPutUrl(key: string, mimeType: string, expiresIn = 300) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      }),
      { expiresIn },
    );
  }

  getPresignedGetUrl(key: string, expiresIn = 3600) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  // Fetch a stored object's raw bytes (e.g. to feed a PDF to an extraction model).
  async getObjectBytes(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`S3 object has no body: ${key}`);
    const bytes = await response.Body.transformToByteArray();
    this.logger.debug(`fetched s3 object key=${key} bytes=${bytes.length}`);
    return Buffer.from(bytes);
  }
}
