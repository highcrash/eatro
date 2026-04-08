import { Module } from '@nestjs/common';
import { RecipeService } from './recipe.service';
import { RecipeController } from './recipe.controller';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';

@Module({
  imports: [UnitConversionModule],
  controllers: [RecipeController],
  providers: [RecipeService],
  exports: [RecipeService],
})
export class RecipeModule {}
