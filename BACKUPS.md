# Database backups and restores

How to back up the production database, keep dated copies, restore one onto a
laptop, and — when production breaks — put production back to an earlier day.

Production Postgres runs **inside Docker on the VM** (`db` service,
`postgres:15-alpine`, data in the `db-data` volume). It publishes no port, so
every backup is taken **on the VM, through the container**. Local Postgres is
also 15, so dumps move between the two cleanly.

> ⚠️ **Two stacks share this VM** (this company and the second one — see
> DEPLOYMENT.md). Every command below must be run from **this project's
> backend folder**, or it backs up (or restores over) the other company's
> database. Run `docker compose ls` first, every time.

Placeholders used below — fill them in once and keep them with this file:

| Placeholder | Meaning |
|---|---|
| `<you>@<vm-address>` | SSH login for the VM |
| `<backend-dir>` | This project's backend checkout on the VM (the folder with its `docker-compose.yml`) |

---

## 1. Take a backup (on the VM)

```bash
ssh <you>@<vm-address>
cd <backend-dir>
docker compose ls                     # confirm this is the right project
mkdir -p ~/backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > ~/backups/isp_$(date +%F_%H%M).dump
ls -lh ~/backups                      # a few MB — never 0 bytes
```

- `exec -T` runs `pg_dump` inside the db container; `-T` (no terminal) keeps
  the binary output from being corrupted.
- `$POSTGRES_USER` / `$POSTGRES_DB` are read from the container itself — no
  password to type, nothing to remember.
- `-Fc` = compressed **custom format**: small, and restorable whole or table
  by table.
- `pg_dump` is a consistent snapshot taken while the app keeps running — no
  downtime.

**Check the backup is readable** (a backup you can't read is no backup):

```bash
docker compose exec -T db pg_restore --list < ~/backups/isp_<date>.dump | head
```

## 2. Copy it off the VM (on your Mac)

A backup that only lives on the VM is lost with the VM.

```bash
mkdir -p ~/Developer/db-backups
scp <you>@<vm-address>:~/backups/isp_<date>.dump ~/Developer/db-backups/
```

- Keep dumps **out of** `~/Documents` / `~/Desktop` (iCloud) and **out of**
  every git repo.
- A dump holds customers' names and phone numbers, partner details and
  password hashes. Store it like you would the `.env`: private disk or a
  **private** bucket — never the public R2 bucket.

## 3. Restore a backup onto your laptop (local dev)

This is also how you **test** that a backup works.

```bash
# 1. Stop the local backend (Ctrl-C in its terminal) so nothing writes.
# 2. Rebuild the local database from the dump.
dropdb isp_feasibility_dev
createdb isp_feasibility_dev
pg_restore --no-owner --no-privileges -d isp_feasibility_dev \
  ~/Developer/db-backups/isp_<date>.dump
# 3. Regenerate the client and start the backend again.
cd ~/Developer/network-graph-map/backend
npx prisma generate
npm run dev
```

- `--no-owner --no-privileges`: prod's tables belong to the `isp` user; your
  local user is different, so ownership is dropped on restore.
- Log in with **production** credentials — the users are prod's now.
- Partner **bank numbers won't decrypt** locally: the dev `BANK_DETAILS_KEY`
  is not prod's, and must stay that way. Photos still load from R2.

Quick check that it landed:

```bash
psql -d isp_feasibility_dev -c 'SELECT count(*) FROM "Building";'
```

## 4. Restore PRODUCTION from a backup (disaster recovery)

Only when production is actually broken. Practise with section 3 first.

```bash
ssh <you>@<vm-address>
cd <backend-dir>
docker compose ls                                       # right project?

# 1. Back up the CURRENT state first — even broken data may be needed later.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > ~/backups/before-restore_$(date +%F_%H%M).dump

# 2. Stop the API so nobody writes during the restore.
docker compose stop api

# 3. Restore the chosen dated backup over the live database.
docker compose exec -T db sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < ~/backups/isp_<the-good-date>.dump

# 4. Start the API again — it runs `prisma migrate deploy` on boot.
docker compose start api
docker compose logs --tail=50 api
```

- `--clean --if-exists` drops each table before recreating it from the backup.
  **Everything written after that backup's time is gone** — that is why step 1
  exists.
- If the backup is older than the code (a migration added since), step 4's
  `migrate deploy` brings the schema forward on boot.

## 5. Automatic nightly backups, kept for 14 days (one-time setup on the VM)

```bash
ssh <you>@<vm-address>
mkdir -p ~/backups
cat > ~/backups/backup-isp.sh <<'EOF'
#!/bin/sh
set -e
cd <backend-dir>
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > ~/backups/isp_$(date +%F_%H%M).dump
# Keep two weeks of dumps.
find ~/backups -name 'isp_*.dump' -mtime +14 -delete
EOF
chmod +x ~/backups/backup-isp.sh
~/backups/backup-isp.sh && ls -lh ~/backups             # run it once by hand

crontab -e
# add this line — every night at 02:30 (VM time):
# 30 2 * * * ~/backups/backup-isp.sh >> ~/backups/backup.log 2>&1
```

Check now and then that new files appear: `ls -lh ~/backups | tail`.

**Still copy a recent dump off the VM** (section 2) every week or so — the
nightly dumps sit on the same disk as the database.

## 6. Also back up, separately from the dumps

- The VM's backend `.env` — above all **`JWT_SECRET`** and
  **`BANK_DETAILS_KEY`**. A restored database with a lost `BANK_DETAILS_KEY`
  has partner bank numbers nobody can ever read again.
- Keep them in a password manager, not next to the dumps.

## 7. What these backups can and can't do

- **Can:** put the database back to the moment of any nightly (or manual)
  dump you still have.
- **Can't:** go back to an exact minute between two dumps — anything written
  between the last dump and the failure is lost. Point-in-time recovery needs
  WAL archiving or a managed database (RDS, Neon, …); worth it once losing a
  day of data matters.
- **Never** restore over production without step 1 of section 4.
- **Never** point a Prisma `--shadow-database-url` (or `migrate dev`) at a real
  database — Prisma **resets** it. That wiped the local dev DB on 13 Oct 2026.

## Quick reference

| Task | Where | Command |
|---|---|---|
| Back up now | VM, `<backend-dir>` | `docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ~/backups/isp_$(date +%F_%H%M).dump` |
| Check a dump | VM | `docker compose exec -T db pg_restore --list < FILE \| head` |
| Copy to Mac | Mac | `scp <you>@<vm-address>:~/backups/FILE ~/Developer/db-backups/` |
| Restore locally | Mac | `dropdb isp_feasibility_dev && createdb isp_feasibility_dev && pg_restore --no-owner --no-privileges -d isp_feasibility_dev FILE` |
| Restore prod | VM, `<backend-dir>` | section 4 — back up first, stop api, `pg_restore --clean --if-exists --no-owner`, start api |
