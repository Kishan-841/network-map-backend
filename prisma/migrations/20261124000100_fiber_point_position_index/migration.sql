-- "Fibres near a splitter" looks up fibre points inside a small box around a pin (24 Nov 2026). Additive.
CREATE INDEX "FiberPoint_latitude_longitude_idx" ON "FiberPoint"("latitude", "longitude");
