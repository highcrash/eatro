import { Controller, Post, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { diskStorage, type StorageEngine } from 'multer';
import * as multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

// ─── Storage selector ──────────────────────────────────────────────────────
// In production we use DigitalOcean Spaces (S3-compatible). In dev, fall back
// to local disk so the project keeps working without any cloud config.

const SPACES_BUCKET = process.env.SPACES_BUCKET ?? '';
const SPACES_KEY = process.env.SPACES_KEY ?? '';
const SPACES_SECRET = process.env.SPACES_SECRET ?? '';
const SPACES_REGION = process.env.SPACES_REGION ?? 'sgp1';
const SPACES_ENDPOINT = process.env.SPACES_ENDPOINT ?? `https://${SPACES_REGION}.digitaloceanspaces.com`;
const SPACES_PUBLIC_BASE = process.env.SPACES_PUBLIC_BASE ?? `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com`;

const useSpaces = Boolean(SPACES_BUCKET && SPACES_KEY && SPACES_SECRET);

let storage: StorageEngine;

if (useSpaces) {
  const s3 = new S3Client({
    region: SPACES_REGION,
    endpoint: SPACES_ENDPOINT,
    forcePathStyle: false,
    credentials: {
      accessKeyId: SPACES_KEY,
      secretAccessKey: SPACES_SECRET,
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storage = (multerS3 as any)({
    s3,
    bucket: SPACES_BUCKET,
    acl: 'public-read',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contentType: (multerS3 as any).AUTO_CONTENT_TYPE,
    key: (_req: Express.Request, file: Express.Multer.File, cb: (err: Error | null, key?: string) => void) => {
      const ext = extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `uploads/${randomUUID()}${ext}`);
    },
  }) as StorageEngine;
} else {
  storage = diskStorage({
    destination: join(process.cwd(), 'apps', 'api', 'uploads'),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${randomUUID()}${ext}`);
    },
  });
}

interface UploadedFileWithLocation extends Express.Multer.File {
  location?: string; // multer-s3 sets this
  key?: string;
}

@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('upload')
export class UploadController {
  @Post('image')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPEG, PNG, WebP, and GIF images are allowed'), false);
        }
      },
    }),
  )
  uploadImage(@UploadedFile() file: UploadedFileWithLocation) {
    if (!file) throw new BadRequestException('No file provided');

    if (useSpaces) {
      // multer-s3 returns the public URL via .location, fall back to constructing it.
      const url = file.location ?? `${SPACES_PUBLIC_BASE}/${file.key}`;
      return { url };
    }

    // Local disk (dev)
    return { url: `/uploads/${file.filename}` };
  }
}
