import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import type { CreateBranchDto, UpdateBranchDto } from '@restora/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BranchService } from './branch.service';

@ApiTags('Branch')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Get()
  @Roles('OWNER', 'MANAGER')
  findAll() {
    return this.branchService.findAll();
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER')
  findOne(@Param('id') id: string) {
    return this.branchService.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateBranchDto) {
    return this.branchService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branchService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.branchService.remove(id);
  }
}
