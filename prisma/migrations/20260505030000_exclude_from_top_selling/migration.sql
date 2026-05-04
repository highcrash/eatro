-- Per-item opt-out from the Top Selling slider on QR + website.
--
-- Pure additive: 1 boolean default false → existing items show
-- normally until admin opts each one out. No FK changes, no row
-- touched.
--
-- Use case: high-volume utility items like water, cola, plain rice
-- always dominate top-N popularity charts and crowd out the
-- actually-interesting dishes admin wants to merchandise on the
-- homepage. Toggling this on hides the item from the Top Selling
-- strip without affecting its visibility anywhere else (category
-- listings, search, New Items, deals).

ALTER TABLE "menu_items"
  ADD COLUMN "excludeFromTopSelling" BOOLEAN NOT NULL DEFAULT false;
