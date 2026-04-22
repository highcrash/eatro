-- Extend the UserRole enum with ADVISOR. Advisors get operational
-- read/write access (menu, recipes, inventory, purchasing, expenses,
-- attendance, reports, discounts) but no access to Accounts, Staff,
-- Branches, Settings, Backups, Data Cleanup, Terminals, Kitchen
-- Sections, Cashier Permissions, or Website editor.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADVISOR';
