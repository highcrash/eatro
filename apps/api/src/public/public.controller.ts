import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicService } from './public.service';

@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('table/:tableId')
  getTableInfo(@Param('tableId') tableId: string) {
    return this.publicService.getTableInfo(tableId);
  }

  @Get('branches')
  getBranches() {
    return this.publicService.getBranches();
  }

  @Get('menu/:branchId')
  getMenu(@Param('branchId') branchId: string) {
    return this.publicService.getMenu(branchId);
  }
}
