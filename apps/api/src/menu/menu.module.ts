import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';

@Module({
  controllers: [CategoryController, MenuController],
  providers: [MenuService, CategoryService],
  exports: [MenuService],
})
export class MenuModule {}
