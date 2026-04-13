import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { BackupService } from './backup.service';

const MAX_BACKUP_UPLOAD = 200 * 1024 * 1024; // 200 MB

@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  constructor(private readonly svc: BackupService) {}

  @Get()
  @Roles('OWNER')
  list() {
    return this.svc.list();
  }

  @Post()
  @Roles('OWNER')
  create(@CurrentUser() user: JwtPayload) {
    return this.svc.createBackup('MANUAL', user.sub);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.svc.deleteBackup(id);
  }

  @Get(':id/download')
  @Roles('OWNER')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { stream, filename, sizeBytes } = await this.svc.getDownloadStream(id);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(sizeBytes));
    stream.pipe(res);
  }

  @Post('restore/:id')
  @Roles('OWNER')
  restoreFromRecord(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { password: string },
  ) {
    if (!dto?.password) throw new BadRequestException('Password required');
    return this.svc.restore({ recordId: id, ownerId: user.sub, password: dto.password });
  }

  @Post('restore/upload')
  @Roles('OWNER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BACKUP_UPLOAD },
    }),
  )
  restoreFromUpload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { password: string },
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!dto?.password) throw new BadRequestException('Password required');
    return this.svc.restore({ uploadedFile: file, ownerId: user.sub, password: dto.password });
  }

  @Get('schedule')
  @Roles('OWNER')
  getSchedule() {
    return this.svc.getSchedule();
  }

  @Put('schedule')
  @Roles('OWNER')
  updateSchedule(@Body() dto: { frequency?: string; timeHour?: number; retention?: number }) {
    return this.svc.updateSchedule(dto);
  }
}
