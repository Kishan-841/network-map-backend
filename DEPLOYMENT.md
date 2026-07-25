# Backend Deployment

Express + Prisma + PostgreSQL API, containerized. Google Maps is called only
from the frontend; the backend needs no Google key.

## Quick start (Docker Compose — API + database in one stack)

```bash
cd backend
cp .env.example .env          # fill in real secrets (see below)
RUN_SEED=true docker compose up -d --build   # FIRST deploy only
# later deploys:
docker compose up -d --build
```

The API comes up on `PORT` (default 4000). Compose runs migrations on start,
persists the database and uploaded files in named volumes, and restarts on
failure. Health: `GET /api/v1/health`.

## Deploying the image elsewhere (managed Postgres, ECS/Fly/Render/K8s)

```bash
docker build -t isp-coverage-api ./backend
docker run -p 4000:4000 --env-file backend/.env \
  -v isp-uploads:/app/uploads isp-coverage-api
```

Point `DATABASE_URL` at your managed database. The container runs
`prisma migrate deploy` before starting.

## Go-live checklist

**Secrets & config**
- [ ] `JWT_SECRET` — long random unique value (`openssl rand -base64 48`). The
      app refuses to boot in production with a weak/default secret.
- [ ] `POSTGRES_PASSWORD` / database credentials changed from defaults.
- [ ] `SEED_ADMIN_PASSWORD` set, then **change the admin password after first
      login** and set `RUN_SEED=false` for subsequent deploys.
- [ ] `APP_URL` = the public URL of this backend (stored file URLs depend on it).
- [ ] `CORS_ORIGIN` = your frontend URL(s), not `*`.

**Data & files**
- [ ] Database is a managed/persistent instance (or the `db-data` volume is
      backed up). Take regular backups.
- [ ] Uploads volume (`/app/uploads`) is persistent and backed up — or switch
      `STORAGE_DRIVER` to S3/R2 (the StorageProvider abstraction is ready).

**Network & security**
- [ ] TLS terminates at a proxy/load balancer in front of the API (HTTPS only).
- [ ] Only the API port is exposed publicly; Postgres is private.
- [ ] Frontend `NEXT_PUBLIC_API_URL` points at the public API URL.
- [ ] Google Maps key (frontend) restricted by HTTP referrer + API, with a
      billing budget alert and per-API quota caps set in Google Cloud.

**Verify after deploy**
- [ ] `curl https://api.yourdomain.com/api/v1/health` → `{"success":true,...}`
- [ ] Log in with the seeded admin; confirm building create + map load work.
- [ ] `docker compose logs api` shows migrations applied, no errors.

## Frontend

The frontend is a Next.js app (`../frontend`) — deploy it on Vercel, or build
its own container. Set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MAP_PROVIDER=google`,
and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in its environment. (Ask if you want a
frontend Dockerfile added too.)
