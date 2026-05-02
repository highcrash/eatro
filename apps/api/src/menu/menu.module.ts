import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [UnitConversionModule, ActivityLogModule],
  controllers: [CategoryController, MenuController],
  providers: [MenuService, CategoryService],
  exports: [MenuService],
})
export class MenuModule {}
