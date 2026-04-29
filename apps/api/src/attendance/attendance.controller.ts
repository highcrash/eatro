import { Controller, Get, Post, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, MarkAttendanceDto } from '@restora/types';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'ADVISOR')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('date') date?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.attendanceService.findAll(user.branchId, date, staffId);
  }

  @Post()
  mark(@CurrentUser() user: JwtPayload, @Body() dto: MarkAttendanceDto) {
    return this.attendanceService.mark(user.branchId, dto);
  }

  /** Drop the manual-override flag on (staff, date) and re-pull from
   *  Tipsoi for that single row. Surfaced as the "Restore from Tipsoi"
   *  button on the admin AttendancePage. */
  @Post('clear-override')
  clearOverride(@CurrentUser() user: JwtPayload, @Body() dto: { staffId: string; date: string }) {
    if (!dto.staffId || !dto.date) throw new BadRequestException('staffId + date required');
    return this.attendanceService.clearOverride(user.branchId, dto.staffId, dto.date);
  }

  @Get('summary')
  getSummary(
    @CurrentUser() user: JwtPayload,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    return this.attendanceService.getMonthSummary(
      user.branchId,
      parseInt(year ?? String(now.getFullYear())),
      parseInt(month ?? String(now.getMonth() + 1)),
    );
  }
}
