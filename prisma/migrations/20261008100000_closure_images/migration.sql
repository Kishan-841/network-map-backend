-- Optional photos of a closure: an array of upload-API URLs, like Fiber.images / Pop.images.
ALTER TABLE "Closure" ADD COLUMN "images" JSONB;
