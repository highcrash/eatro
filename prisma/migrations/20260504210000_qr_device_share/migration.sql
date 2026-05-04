-- Multi-device QR ordering: per-order device-id anchor + share list.
--
-- Pure additive: two nullable columns on `orders`. No FK changes,
-- no enum mutation, no row touched.
--
-- primaryDeviceId — set from the x-qr-device-id header on POST
-- /orders/qr. Null for POS-created orders. The auth check on QR
-- mutations (add-items, cancel-item, request-bill, etc.) gates on
-- (deviceId == primaryDeviceId) OR (deviceId IN sharedDeviceIds) OR
-- (customerId match), so existing orders with null primaryDeviceId
-- short-circuit to the customer-match path same as today.
--
-- sharedDeviceIds — JSON-encoded string array of device UUIDs that
-- the primary device approved via the request-share / approve-share
-- flow. TEXT so PostgreSQL backups work cleanly without jsonb-array
-- manipulation.

ALTER TABLE "orders"
  ADD COLUMN "primaryDeviceId" TEXT,
  ADD COLUMN "sharedDeviceIds" TEXT;
