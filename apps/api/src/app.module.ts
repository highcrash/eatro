import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BranchModule } from './branch/branch.module';
import { MenuModule } from './menu/menu.module';
import { OrderModule } from './order/order.module';
import { TableModule } from './table/table.module';
import { StaffModule } from './staff/staff.module';
import { HealthModule } from './health/health.module';
import { WsGatewayModule } from './ws-gateway/ws-gateway.module';
import { SupplierModule } from './supplier/supplier.module';
import { CreditorModule } from './creditor/creditor.module';
import { TipsoiModule } from './tipsoi/tipsoi.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { SocialModule } from './social/social.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { IngredientModule } from './ingredient/ingredient.module';
import { RecipeModule } from './recipe/recipe.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { PublicModule } from './public/public.module';
import { ReportsModule } from './reports/reports.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PayrollModule } from './payroll/payroll.module';
import { WasteModule } from './waste/waste.module';
import { ExpenseModule } from './expense/expense.module';
import { AccountModule } from './account/account.module';
import { PreReadyModule } from './pre-ready/pre-ready.module';
import { LeaveModule } from './leave/leave.module';
import { WorkPeriodModule } from './work-period/work-period.module';
import { CookingStationModule } from './cooking-station/cooking-station.module';
import { UnitConversionModule } from './unit-conversion/unit-conversion.module';
import { CustomUnitModule } from './custom-unit/custom-unit.module';
import { QrGateModule } from './qr-gate/qr-gate.module';
import { PaymentMethodModule } from './payment-method/payment-method.module';
import { UploadModule } from './upload/upload.module';
import { DiscountModule } from './discount/discount.module';
import { SmsModule } from './sms/sms.module';
import { MushakModule } from './mushak/mushak.module';
import { CustomRoleModule } from './custom-role/custom-role.module';
import { CustomerModule } from './customer/customer.module';
import { BrandingModule } from './branding/branding.module';
import { PermissionsModule } from './permissions/permissions.module';
import { CashierOpsModule } from './cashier-ops/cashier-ops.module';
import { WebsiteModule } from './website/website.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { ReservationModule } from './reservation/reservation.module';
import { BackupModule } from './backup/backup.module';
import { BranchSettingsModule } from './branch-settings/branch-settings.module';
import { DeviceModule } from './device-registration/device.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { InstallModule } from './install/install.module';
import { LicenseModule } from './license/license.module';
import { UpdaterModule } from './updater/updater.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Rate limiting — 100 req/min general, auth overridden in AuthModule
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
    ]),

    // Infrastructure
    PrismaModule,
    // License gate — must come right after Prisma (depends on it) and
    // before any feature module whose mutations call `assertMutation()`.
    // Also installs the global APP_GUARD so every request goes through
    // the host + verdict checks.
    ScheduleModule.forRoot(),
    LicenseModule,
    // InstallModule sits here so its routes are mounted but its guard
    // 404s them once the wizard finishes. Order doesn't matter relative
    // to feature modules — the wizard owns its own controller and
    // doesn't depend on (or get depended on by) anything else.
    InstallModule,
    // Updater sits next to Install — same lifecycle-surgery shape:
    // mutates the install tree at runtime. OWNER-only in the admin UI.
    UpdaterModule,
    WsGatewayModule,

    // Feature modules (Phase 1)
    HealthModule,
    AuthModule,
    BranchModule,
    MenuModule,
    TableModule,
    OrderModule,
    StaffModule,

    // Feature modules (Phase 2)
    SupplierModule,
    IngredientModule,
    RecipeModule,

    // Feature modules (Phase 3)
    PurchasingModule,

    // Feature modules (Phase 4)
    PublicModule,

    // Feature modules (Phase 5)
    ReportsModule,

    // Feature modules (Phase 6)
    AttendanceModule,
    PayrollModule,

    // Feature modules (Phase 7)
    WasteModule,

    // Expense Management
    ExpenseModule,

    // Account Management
    AccountModule,

    // Pre-Ready Foods
    PreReadyModule,

    // Leave Management
    LeaveModule,

    // Work Period & Cooking Stations
    WorkPeriodModule,
    CookingStationModule,

    // Unit Conversions
    UnitConversionModule,
    CustomUnitModule,
    QrGateModule,
    PaymentMethodModule,

    // File Upload
    UploadModule,

    // Discounts & Coupons
    DiscountModule,

    // SMS & Notifications
    SmsModule,

    // NBR Mushak (Bangladesh VAT) compliance
    MushakModule,

    // Custom roles — admin-configurable permission presets
    CustomRoleModule,

    // Customer Management
    CustomerModule,

    // Branding & Theming
    BrandingModule,

    // Cashier Permissions (Phase 6)
    PermissionsModule,

    // POS Cashier Operations (Phase 7-9)
    CashierOpsModule,

    // Public Website + CMS (Phase 4-5)
    WebsiteModule,

    // Data Cleanup (OWNER-only destructive ops)
    CleanupModule,

    // Database Backup/Restore (OWNER-only)
    BackupModule,

    // Branch-level POS settings (KDS toggle, etc.)
    BranchSettingsModule,

    // Desktop cashier terminals (pairing, pin-login, admin revoke)
    DeviceModule,

    // Idempotent mutation responses — desktop outbox retries land here.
    IdempotencyModule,

    // Reservation System
    ReservationModule,

    // Liabilities (Creditors) — utilities, rent, loans
    CreditorModule,

    // Tipsoi attendance integration — hourly sync of biometric clock
    // events into Attendance rows + branch/per-staff shift rules.
    TipsoiModule,

    // WhatsApp Cloud API — admin-config surface (settings + test ping)
    // and the shared service used by PurchasingService to send PO PDFs.
    WhatsAppModule,

    // Auto-Facebook-post pipeline for menu discounts. Settings
    // tab + queue panel + per-minute cron worker. Default off
    // per branch.
    SocialModule,

    // Generic admin-config audit trail. Other modules call
    // ActivityLogService.log(...) fire-and-forget after mutations;
    // the controller serves the paginated viewer; the scheduler
    // auto-purges rows older than 90 days.
    ActivityLogModule,
  ],
})
export class AppModule {}
