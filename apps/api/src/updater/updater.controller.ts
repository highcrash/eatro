import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { UpdaterService } from './updater.service';

/**
 * Admin-only updater endpoints. OWNER role required — the Settings
 * → Updates page is hidden from everyone else, and the server-side
 * RolesGuard is the authoritative check.
 *
 * Upload size limit: 100 MB. A full buyer zip is ~2 MB today;
 * leaving headroom for future additions like screenshots / bundled
 * docs. Raising the cap is a one-liner if a release ever outgrows it.
 */
@ApiTags('Updater')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
@Controller('updater')
export class UpdaterController {
  constructor(private readonly svc: UpdaterService) {}

  @Get('history')
  history() {
    return this.svc.history();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('zip', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No zip uploaded (expected form field "zip")');
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('Only .zip uploads are accepted');
    }
    return this.svc.stageUpload({
      zipBuffer: file.buffer,
      originalName: file.originalname,
      uploadedById: user.sub,
    });
  }

  @Post('apply/:id')
  async apply(@Param('id') id: string, @Body() body: { notes?: string }) {
    return this.svc.applyStaged(id, body?.notes);
  }

  @Post('rollback/:id')
  async rollback(@Param('id') id: string) {
    return this.svc.rollback(id);
  }
}
