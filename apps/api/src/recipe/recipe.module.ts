import { Module } from '@nestjs/common';
import { RecipeService } from './recipe.service';
import { RecipeController } from './recipe.controller';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';
import { IngredientModule } from '../ingredient/ingredient.module';

@Module({
  imports: [UnitConversionModule, IngredientModule],
  controllers: [RecipeController],
  providers: [RecipeService],
  exports: [RecipeService],
})
export class RecipeModule {}
