-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'DELIVERY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING');

-- CreateEnum
CREATE TYPE "KitchenTicketStatus" AS ENUM ('NEW', 'PENDING_APPROVAL', 'ACKNOWLEDGED', 'PREPARING', 'DONE', 'RECALLED');

-- CreateEnum
CREATE TYPE "MenuItemType" AS ENUM ('FOOD', 'BEVERAGE', 'MODIFIER');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('FLAT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "DiscountScope" AS ENUM ('ALL_ITEMS', 'SPECIFIC_ITEMS', 'ALL_EXCEPT');

-- CreateEnum
CREATE TYPE "LinkedItemType" AS ENUM ('FREE', 'COMPLEMENTARY');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'UTILITIES', 'SALARY', 'SUPPLIES', 'MAINTENANCE', 'TRANSPORT', 'MARKETING', 'FOOD_COST', 'STAFF_FOOD', 'MISCELLANEOUS');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'MFS', 'POS_TERMINAL');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SALE', 'EXPENSE', 'PURCHASE_PAYMENT', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('PENDING', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'WASTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierCategory" AS ENUM ('MEAT', 'FISH', 'VEGETABLES', 'DAIRY', 'SPICES', 'CLEANING', 'PACKAGING', 'BEVERAGE', 'GENERAL');

-- CreateEnum
CREATE TYPE "IngredientCategory" AS ENUM ('RAW', 'CLEANING', 'PACKAGED', 'SPICE', 'DAIRY', 'BEVERAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'SALE', 'VOID_RETURN', 'ADJUSTMENT', 'WASTE');

-- CreateEnum
CREATE TYPE "StockUnit" AS ENUM ('KG', 'G', 'L', 'ML', 'PCS', 'DOZEN', 'BOX');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'PAID_LEAVE', 'SICK_LEAVE', 'FESTIVAL_LEAVE');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('SICK', 'CASUAL', 'ANNUAL', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "WasteReason" AS ENUM ('SPOILAGE', 'PREPARATION_ERROR', 'OVERCOOKED', 'CONTAMINATION', 'EXPIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "payment_method_configs" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_method_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_options" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "stockPricingMethod" TEXT NOT NULL DEFAULT 'LAST_PURCHASE',
    "logoUrl" TEXT,
    "posLogoUrl" TEXT,
    "websiteTagline" TEXT,
    "billHeaderText" TEXT,
    "billFooterText" TEXT,
    "facebookUrl" TEXT,
    "instagramUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_settings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsApiKey" TEXT,
    "smsApiUrl" TEXT NOT NULL DEFAULT 'https://api.sms.net.bd/sendsms',
    "notifyVoidOtp" BOOLEAN NOT NULL DEFAULT true,
    "posTheme" TEXT NOT NULL DEFAULT 'sunrise',
    "websiteTheme" TEXT NOT NULL DEFAULT 'sunrise',
    "customThemes" TEXT,
    "cashierPermissions" TEXT,

    CONSTRAINT "branch_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_content" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "heroTitle" TEXT NOT NULL DEFAULT 'Welcome',
    "heroSubtitle" TEXT,
    "heroImageUrl" TEXT,
    "heroCtaText" TEXT NOT NULL DEFAULT 'View Menu',
    "aboutTitle" TEXT NOT NULL DEFAULT 'About Us',
    "aboutBody" TEXT NOT NULL DEFAULT '',
    "aboutImageUrl" TEXT,
    "contactNote" TEXT,
    "mapEmbedUrl" TEXT,
    "featuredCategoryIds" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CASHIER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hireDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monthlySalary" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableNumber" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "floorPlanX" DOUBLE PRECISION,
    "floorPlanY" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "MenuItemType" NOT NULL DEFAULT 'FOOD',
    "price" DECIMAL(14,2) NOT NULL,
    "costPrice" DECIMAL(14,2),
    "imageUrl" TEXT,
    "tags" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "isCombo" BOOLEAN NOT NULL DEFAULT false,
    "cookingStationId" TEXT,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_items" (
    "id" TEXT NOT NULL,
    "comboMenuId" TEXT NOT NULL,
    "includedItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "combo_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linked_items" (
    "id" TEXT NOT NULL,
    "parentMenuId" TEXT NOT NULL,
    "linkedMenuId" TEXT NOT NULL,
    "type" "LinkedItemType" NOT NULL DEFAULT 'FREE',
    "triggerQuantity" INTEGER NOT NULL DEFAULT 1,
    "freeQuantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "linked_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Walk-in',
    "email" TEXT,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lastVisit" TIMESTAMP(3),
    "agreedTerms" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "foodScore" INTEGER NOT NULL,
    "serviceScore" INTEGER NOT NULL,
    "atmosphereScore" INTEGER NOT NULL,
    "priceScore" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "tableId" TEXT,
    "tableNumber" TEXT,
    "type" "OrderType" NOT NULL DEFAULT 'DINE_IN',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountId" TEXT,
    "discountName" TEXT,
    "couponId" TEXT,
    "couponCode" TEXT,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "waiterId" TEXT,
    "billRequested" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "menuItemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "kitchenStatus" "KitchenTicketStatus" NOT NULL DEFAULT 'NEW',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "scope" "DiscountScope" NOT NULL DEFAULT 'ALL_ITEMS',
    "targetItems" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "scope" "DiscountScope" NOT NULL DEFAULT 'ALL_ITEMS',
    "targetItems" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_discounts" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "applicableDays" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'MISCELLANEOUS',
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "date" DATE NOT NULL,
    "recordedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showInPOS" BOOLEAN NOT NULL DEFAULT false,
    "linkedPaymentMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_transactions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_ready_items" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "StockUnit" NOT NULL DEFAULT 'PCS',
    "currentStock" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "minimumStock" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pre_ready_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_ready_recipes" (
    "id" TEXT NOT NULL,
    "preReadyItemId" TEXT NOT NULL,
    "yieldQuantity" DECIMAL(14,4) NOT NULL,
    "yieldUnit" "StockUnit" NOT NULL DEFAULT 'G',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_ready_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_ready_recipe_items" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" "StockUnit" NOT NULL DEFAULT 'G',

    CONSTRAINT "pre_ready_recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "preReadyItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "status" "ProductionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_ready_batches" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "preReadyItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "remainingQty" DECIMAL(14,4) NOT NULL,
    "makingDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_ready_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "category" "SupplierCategory" NOT NULL DEFAULT 'GENERAL',
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "visibleToCashier" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "notes" TEXT,
    "paidById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT,
    "name" TEXT NOT NULL,
    "itemCode" TEXT,
    "category" "IngredientCategory" NOT NULL DEFAULT 'RAW',
    "unit" "StockUnit" NOT NULL DEFAULT 'G',
    "purchaseUnit" TEXT,
    "purchaseUnitQty" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "currentStock" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "minimumStock" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "costPerUnit" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "costPerPurchaseUnit" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_suppliers" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "ingredient_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" "StockUnit" NOT NULL DEFAULT 'G',

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "notes" TEXT,
    "orderId" TEXT,
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "orderedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "unit" TEXT,
    "quantityOrdered" DECIMAL(14,4) NOT NULL,
    "quantityReceived" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "makingDate" DATE,
    "expiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "baseSalary" DECIMAL(14,2) NOT NULL,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bonuses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(14,2) NOT NULL,
    "daysPresent" INTEGER NOT NULL DEFAULT 0,
    "daysAbsent" INTEGER NOT NULL DEFAULT 0,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payments" (
    "id" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "notes" TEXT,
    "paidById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_applications" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL DEFAULT 'CASUAL',
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_logs" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "reason" "WasteReason" NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_periods" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startedById" TEXT NOT NULL,
    "endedById" TEXT,
    "notes" TEXT,
    "openingCash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingMFS" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingCard" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closingCash" DECIMAL(14,2),
    "closingMFS" DECIMAL(14,2),
    "closingCard" DECIMAL(14,2),
    "balancesJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cooking_stations" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "printerName" TEXT,
    "printerIp" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cooking_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_conversions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fromUnit" "StockUnit" NOT NULL,
    "toUnit" "StockUnit" NOT NULL,
    "factor" DECIMAL(14,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "supplierId" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "requestedById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_method_configs_branchId_isActive_idx" ON "payment_method_configs"("branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_configs_branchId_code_key" ON "payment_method_configs"("branchId", "code");

-- CreateIndex
CREATE INDEX "payment_options_branchId_categoryId_isActive_idx" ON "payment_options"("branchId", "categoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "payment_options_branchId_code_key" ON "payment_options"("branchId", "code");

-- CreateIndex
CREATE INDEX "branches_isActive_idx" ON "branches"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "branch_settings_branchId_key" ON "branch_settings"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "website_content_branchId_key" ON "website_content"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE INDEX "staff_branchId_isActive_idx" ON "staff"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "staff_email_idx" ON "staff"("email");

-- CreateIndex
CREATE INDEX "dining_tables_branchId_status_idx" ON "dining_tables"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_branchId_tableNumber_key" ON "dining_tables"("branchId", "tableNumber");

-- CreateIndex
CREATE INDEX "menu_categories_branchId_sortOrder_idx" ON "menu_categories"("branchId", "sortOrder");

-- CreateIndex
CREATE INDEX "menu_items_branchId_categoryId_isAvailable_idx" ON "menu_items"("branchId", "categoryId", "isAvailable");

-- CreateIndex
CREATE INDEX "menu_items_branchId_sortOrder_idx" ON "menu_items"("branchId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "combo_items_comboMenuId_includedItemId_key" ON "combo_items"("comboMenuId", "includedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "linked_items_parentMenuId_linkedMenuId_key" ON "linked_items"("parentMenuId", "linkedMenuId");

-- CreateIndex
CREATE INDEX "customers_branchId_phone_idx" ON "customers"("branchId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_branchId_phone_key" ON "customers"("branchId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_orderId_key" ON "reviews"("orderId");

-- CreateIndex
CREATE INDEX "reviews_branchId_idx" ON "reviews"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_branchId_status_idx" ON "orders"("branchId", "status");

-- CreateIndex
CREATE INDEX "orders_branchId_createdAt_idx" ON "orders"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_orderNumber_idx" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_menuItemId_idx" ON "order_items"("menuItemId");

-- CreateIndex
CREATE INDEX "order_payments_orderId_idx" ON "order_payments"("orderId");

-- CreateIndex
CREATE INDEX "discounts_branchId_isActive_idx" ON "discounts"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "coupons_branchId_isActive_idx" ON "coupons"("branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_branchId_code_key" ON "coupons"("branchId", "code");

-- CreateIndex
CREATE INDEX "menu_item_discounts_menuItemId_isActive_idx" ON "menu_item_discounts"("menuItemId", "isActive");

-- CreateIndex
CREATE INDEX "expenses_branchId_date_idx" ON "expenses"("branchId", "date");

-- CreateIndex
CREATE INDEX "expenses_branchId_category_idx" ON "expenses"("branchId", "category");

-- CreateIndex
CREATE INDEX "accounts_branchId_isActive_idx" ON "accounts"("branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_branchId_type_name_key" ON "accounts"("branchId", "type", "name");

-- CreateIndex
CREATE INDEX "account_transactions_branchId_createdAt_idx" ON "account_transactions"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "account_transactions_accountId_idx" ON "account_transactions"("accountId");

-- CreateIndex
CREATE INDEX "pre_ready_items_branchId_isActive_idx" ON "pre_ready_items"("branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "pre_ready_recipes_preReadyItemId_key" ON "pre_ready_recipes"("preReadyItemId");

-- CreateIndex
CREATE UNIQUE INDEX "pre_ready_recipe_items_recipeId_ingredientId_key" ON "pre_ready_recipe_items"("recipeId", "ingredientId");

-- CreateIndex
CREATE INDEX "production_orders_branchId_status_idx" ON "production_orders"("branchId", "status");

-- CreateIndex
CREATE INDEX "pre_ready_batches_branchId_expiryDate_idx" ON "pre_ready_batches"("branchId", "expiryDate");

-- CreateIndex
CREATE INDEX "pre_ready_batches_preReadyItemId_idx" ON "pre_ready_batches"("preReadyItemId");

-- CreateIndex
CREATE INDEX "suppliers_branchId_isActive_idx" ON "suppliers"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "supplier_payments_branchId_supplierId_idx" ON "supplier_payments"("branchId", "supplierId");

-- CreateIndex
CREATE INDEX "ingredients_branchId_isActive_idx" ON "ingredients"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "ingredients_itemCode_idx" ON "ingredients"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_suppliers_ingredientId_supplierId_key" ON "ingredient_suppliers"("ingredientId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_menuItemId_key" ON "recipes"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipeId_ingredientId_key" ON "recipe_items"("recipeId", "ingredientId");

-- CreateIndex
CREATE INDEX "stock_movements_branchId_createdAt_idx" ON "stock_movements"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_ingredientId_idx" ON "stock_movements"("ingredientId");

-- CreateIndex
CREATE INDEX "purchase_orders_branchId_status_idx" ON "purchase_orders"("branchId", "status");

-- CreateIndex
CREATE INDEX "attendance_branchId_date_idx" ON "attendance"("branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_staffId_date_key" ON "attendance"("staffId", "date");

-- CreateIndex
CREATE INDEX "payrolls_branchId_periodStart_idx" ON "payrolls"("branchId", "periodStart");

-- CreateIndex
CREATE INDEX "payrolls_staffId_idx" ON "payrolls"("staffId");

-- CreateIndex
CREATE INDEX "payroll_payments_payrollId_idx" ON "payroll_payments"("payrollId");

-- CreateIndex
CREATE INDEX "leave_applications_branchId_staffId_idx" ON "leave_applications"("branchId", "staffId");

-- CreateIndex
CREATE INDEX "waste_logs_branchId_createdAt_idx" ON "waste_logs"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "waste_logs_ingredientId_idx" ON "waste_logs"("ingredientId");

-- CreateIndex
CREATE INDEX "work_periods_branchId_startedAt_idx" ON "work_periods"("branchId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cooking_stations_branchId_name_key" ON "cooking_stations"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "unit_conversions_branchId_fromUnit_toUnit_key" ON "unit_conversions"("branchId", "fromUnit", "toUnit");

-- CreateIndex
CREATE INDEX "purchase_returns_branchId_idx" ON "purchase_returns"("branchId");

-- AddForeignKey
ALTER TABLE "payment_method_configs" ADD CONSTRAINT "payment_method_configs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_options" ADD CONSTRAINT "payment_options_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_options" ADD CONSTRAINT "payment_options_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "payment_method_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_options" ADD CONSTRAINT "payment_options_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_content" ADD CONSTRAINT "website_content_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "menu_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_cookingStationId_fkey" FOREIGN KEY ("cookingStationId") REFERENCES "cooking_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_comboMenuId_fkey" FOREIGN KEY ("comboMenuId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_includedItemId_fkey" FOREIGN KEY ("includedItemId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linked_items" ADD CONSTRAINT "linked_items_parentMenuId_fkey" FOREIGN KEY ("parentMenuId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linked_items" ADD CONSTRAINT "linked_items_linkedMenuId_fkey" FOREIGN KEY ("linkedMenuId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_discounts" ADD CONSTRAINT "menu_item_discounts_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_ready_items" ADD CONSTRAINT "pre_ready_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_ready_recipes" ADD CONSTRAINT "pre_ready_recipes_preReadyItemId_fkey" FOREIGN KEY ("preReadyItemId") REFERENCES "pre_ready_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_ready_recipe_items" ADD CONSTRAINT "pre_ready_recipe_items_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "pre_ready_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_ready_recipe_items" ADD CONSTRAINT "pre_ready_recipe_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_preReadyItemId_fkey" FOREIGN KEY ("preReadyItemId") REFERENCES "pre_ready_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_ready_batches" ADD CONSTRAINT "pre_ready_batches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_ready_batches" ADD CONSTRAINT "pre_ready_batches_preReadyItemId_fkey" FOREIGN KEY ("preReadyItemId") REFERENCES "pre_ready_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_suppliers" ADD CONSTRAINT "ingredient_suppliers_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_suppliers" ADD CONSTRAINT "ingredient_suppliers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_periods" ADD CONSTRAINT "work_periods_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_periods" ADD CONSTRAINT "work_periods_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_periods" ADD CONSTRAINT "work_periods_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooking_stations" ADD CONSTRAINT "cooking_stations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

