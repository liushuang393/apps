import { S3Client } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import logger from '../utils/logger.util';

dotenv.config();

// AWS S3 Configuration (Optional - currently not used)
// Images are stored locally in the file system
// If you need cloud storage in the future, configure these environment variables

const isS3Configured = !!(
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_S3_BUCKET
);

if (isS3Configured) {
  logger.info('✓ AWS S3 configured');
} else {
  logger.info('ℹ AWS S3 not configured - using local file storage');
}

// AWS SDK v3 S3 Client
export const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-1',
  ...(isS3Configured && {
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  }),
});

export const S3_BUCKET = process.env.AWS_S3_BUCKET || '';
export const IS_S3_ENABLED = isS3Configured;

export default s3;
