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

The API is published on the host at `API_PUBLISH` (default `127.0.0.1:5004`,
chosen to avoid the other stacks on this VM — 5001/5002/5003/5432/5500). Postgres
is **not** published to the host (internal to the compose network), so it never
clashes with the other databases' 5432. Compose runs migrations on start,
persists the database and uploaded files in named volumes, and restarts on
failure. Health: `GET /api/v1/health`.

If you add more services later, check free ports with `docker ps` and set
`API_PUBLISH` accordingly.

## A second company on the same VM

Each compose stack already brings its own Postgres, its own volumes and its own
`.env`, so a second customer is a second stack — no code changes. What follows
is only the things that must NOT be shared.

### 1. Give the stack its own compose project name

**This is the one that loses data.** Compose derives the project name from the
directory, and volumes are named `<project>_db-data`. Two checkouts in
identically-named directories share a project — the second stack attaches to the
FIRST company's database.

```bash
git clone <repo> acme-backend     # a distinct directory name, or:
echo 'COMPOSE_PROJECT_NAME=acme' >> .env
docker compose ls                 # confirm two separate projects before starting
```

### 2. A fresh `JWT_SECRET` — not a copy

Most tokens carry a cuid `sub` that would not resolve in the other database, so
they fail harmlessly. **The partner signup token does not.** It carries only
`{ mobile }` (`partner-auth.service.js`), and `register` accepts it if that
mobile matches. With a shared secret, a signup token minted by company A is
valid on company B: verify an OTP on A, then create a partner account on B
having never proved the number there.

```bash
openssl rand -hex 32
```

### 3. Its own R2 bucket

Object keys are `dir/<uuid>.<ext>` with no per-customer prefix, so one bucket
means both companies' identity documents share a namespace — and the bucket is
public until you close it. Create a second bucket, a second R2 API token scoped
to it, and set `R2_BUCKET` / `R2_PUBLIC_URL` / the access keys accordingly. Two
buckets also means you can revoke or lock one without touching the other.

### 4. Its own Google Maps key

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is compiled into the browser bundle, so it is
public by design and only HTTP-referrer restrictions protect it.

- Restrict each key to that customer's domain, and to the two APIs actually
  used: Maps JavaScript API and Places API (New).
- Prefer a key per customer, ideally in its own GCP project. Sharing one key
  shares the quota and the bill — Places autocomplete is billed per session, and
  on a shared key you cannot tell whose spend is whose, or stop one customer
  exhausting the other's budget.

### 5. Everything else that is per-customer

| Variable | Why it cannot be copied |
| --- | --- |
| `API_PUBLISH` | Host port must be unique. In use on this VM: 5001–5004, 5432, 5500 |
| `POSTGRES_PASSWORD` | Defaults to `isp`; set a real one per stack |
| `CORS_ORIGIN`, `WEB_URL`, `APP_URL` | `WEB_URL` falls back to the first CORS origin, and partner **invite links are built from it** — copy these and company B emails links pointing at company A's site |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Set both, then `RUN_SEED=true` on the first deploy only |
| `BANK_DETAILS_KEY` | Encrypts partners' bank account numbers. A fresh key per stack — a shared key means one company's database dump is readable with the other's `.env`. See the go-live checklist for how to make one and why it can never change |
| `NODE_ENV=production` | The image sets it; do not override it in `.env`. It is what makes the server refuse to boot with `SHOW_OTP_IN_RESPONSE` or `ALLOW_APPROVAL_BYPASS` on |

Leave `SHOW_OTP_IN_RESPONSE` and `ALLOW_APPROVAL_BYPASS` unset entirely.

### 6. After it is up

- `docker compose ls` — two projects, two `db-data` volumes.
- Back up **both** volumes; a backup script written for one stack silently
  covers only that one.
- Two Postgres and two Node processes now share the VM's memory — check
  `free -m` under load before promising uptime.
- Every future release has to be deployed twice. Tag the image so both stacks
  can be moved to the same version deliberately rather than by rebuilding each
  from whatever `main` happens to be.

### Frontend

A separate Vercel project with its own `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. `NEXT_PUBLIC_*` values are baked in at build
time — changing one needs a redeploy, not a restart.

---

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
- [ ] `BANK_DETAILS_KEY` — **required**; the server refuses to boot without
      it. 32 random bytes, base64:
      `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
      It encrypts every partner's bank account number (AES-256-GCM).
  - **Set it on the VM before merging the backend PR that introduces it.** The
    container runs `prisma migrate deploy` and then starts the API; with no key
    the API exits at boot and the container crash-loops.
  - **Back it up like `JWT_SECRET`, somewhere outside the VM.** Lose it and
    every stored account number is unreadable — partners would have to re-enter
    their bank details.
  - **Never change it once bank details are stored.** There is no key rotation
    yet: a new key makes every existing number unreadable (payouts show
    "Bank details unreadable" for those partners).
  - **Rolling back:** once any `CANCELLED_CHEQUE` document rows exist, roll
    forward only. The previous image's Prisma client does not know that enum
    value and fails on reading those rows.
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
