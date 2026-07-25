# ISP Coverage API — production image
# Debian slim (not Alpine) keeps Prisma's OpenSSL engine painless.
FROM node:22-bookworm-slim

ENV NODE_ENV=production

# Prisma needs openssl; dumb-init gives us a proper PID 1 for signal handling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production deps only. The schema is copied first so @prisma/client's
# postinstall can generate the client during install.
COPY package*.json ./
COPY prisma ./prisma
# npm install (not ci) tolerates cross-platform optional-dep resolution
# differences that would make strict `npm ci` fail on some hosts.
RUN npm install --omit=dev --no-audit --no-fund \
  && npx prisma generate \
  && npm cache clean --force

# App source
COPY . .

# Run as an unprivileged user; uploads dir is a mount point (see compose).
RUN useradd --system --uid 1001 --create-home appuser \
  && mkdir -p /app/uploads \
  && chown -R appuser:appuser /app
USER appuser

EXPOSE 4000

# Container-native health signal (used by orchestrators and compose).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["./docker-entrypoint.sh"]
