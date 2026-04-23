import { Controller, Get, Param, Query, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@restora/types';
import { MushakService } from './mushak.service';

@Controller('mushak')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MushakController {
  constructor(private readonly svc: MushakService) {}

  @Get('invoices/:id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR', 'CASHIER')
  getInvoice(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getInvoiceById(id, user.branchId);
  }

  @Get('invoices/by-order/:orderId')
  @Roles('OWNER', 'MANAGER', 'ADVISOR', 'CASHIER', 'WAITER')
  getInvoiceByOrder(@CurrentUser() user: JwtPayload, @Param('orderId') orderId: string) {
    return this.svc.getInvoiceByOrder(orderId, user.branchId);
  }

  @Get('notes/:id')
  @Roles('OWNER', 'MANAGER', 'ADVISOR', 'CASHIER')
  getNote(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getNoteById(id, user.branchId);
  }

  @Get('invoices/:id/notes')
  @Roles('OWNER', 'MANAGER', 'ADVISOR', 'CASHIER')
  listNotesForInvoice(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.listNotesByInvoice(id, user.branchId);
  }

  @Get('register')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  register(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filter') filter?: 'all' | 'invoice' | 'note',
  ) {
    const { fromDate, toDate } = parseRange(from, to);
    return this.svc.listRegister(user.branchId, fromDate, toDate, filter ?? 'all');
  }

  @Get('register.csv')
  @Roles('OWNER', 'MANAGER', 'ADVISOR')
  async registerCsv(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { fromDate, toDate } = parseRange(from, to);
    const csv = await this.svc.exportRegisterCsv(user.branchId, fromDate, toDate);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mushak-register-${fromDate.toISOString().slice(0, 10)}_${toDate.toISOString().slice(0, 10)}.csv"`,
    });
    res.send(csv);
  }
}

function parseRange(from?: string, to?: string): { fromDate: Date; toDate: Date } {
  if (!from || !to) throw new BadRequestException('from and to are required (ISO date)');
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new BadRequestException('from/to must be parseable dates');
  }
  // Include the entire `to` day so the picker's inclusive semantic matches.
  toDate.setHours(23, 59, 59, 999);
  return { fromDate, toDate };
}
