UPDATE "Closure" SET "code" = 'JC-' || substring("code" from 4) WHERE "code" LIKE 'CL-%';
