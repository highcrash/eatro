-- Receipt attachments uploaded at goods-receive time. Append-only
-- JSON array of `{ url, type: 'image' | 'pdf', uploadedAt }`. Each
-- receive call PUSHES new entries so multi-shipment POs keep the full
-- paper trail.
ALTER TABLE "purchase_orders" ADD COLUMN "receiptAttachments" JSONB;
