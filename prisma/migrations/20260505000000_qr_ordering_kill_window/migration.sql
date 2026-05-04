-- QR ordering master kill switch + service window.
--
-- Pure additive: 1 boolean (default true → existing branches keep
-- ordering on, no behaviour change) + 2 nullable HH:mm strings
-- (null = no window enforced). No FK changes, no row touched.
--
-- Two new admin levers on top of the existing Wi-Fi gate:
--   - qrOrderingEnabled = false → every QR scan + every QR mutation
--     lands on a "we are not accepting QR orders right now, please
--     ask staff for assistance" screen. Useful for short-lived
--     issues (kitchen overwhelmed, runner ran out, etc.).
--   - qrOrderingWindowStart + qrOrderingWindowEnd → optional service
--     window in HH:mm. Outside the window the QR app shows "Sorry,
--     we are not accepting orders right now" with the hours.

ALTER TABLE "branches"
  ADD COLUMN "qrOrderingEnabled"     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "qrOrderingWindowStart" TEXT,
  ADD COLUMN "qrOrderingWindowEnd"   TEXT;
