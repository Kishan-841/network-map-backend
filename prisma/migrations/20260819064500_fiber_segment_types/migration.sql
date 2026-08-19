-- Move the fiber type INTO each segment: [[points]] → [{fiberType, points}].
-- Old rows inherit the route-level type (default '2 core' when unset).
UPDATE "FiberRoute"
SET "segments" = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'fiberType', COALESCE("fiberType", '2 core'),
        'points', seg
      )
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements("segments"::jsonb) AS seg
)
WHERE jsonb_typeof("segments"::jsonb -> 0) = 'array';

-- Route-level type and color are superseded by per-segment types with fixed
-- per-type colors.
ALTER TABLE "FiberRoute" DROP COLUMN "fiberType";
ALTER TABLE "FiberRoute" DROP COLUMN "color";
