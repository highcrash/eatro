-- Non-recipe supplies: a new Ingredient category for items like
-- tissues, parcel bags, cleaner, plates, and a matching StockMovement
-- type for the manual "Record Usage" log on Inventory → Supplies.
-- Pure additive: existing rows untouched.

ALTER TYPE "IngredientCategory" ADD VALUE 'SUPPLY';
ALTER TYPE "StockMovementType" ADD VALUE 'OPERATIONAL_USE';
