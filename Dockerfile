FROM node:24.14.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV GRAILHIIV_STANDALONE=true
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24.14.0-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3100
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3100
CMD ["node", "server.js"]

FROM dependencies AS worker
COPY --chown=node:node src/lib/n8n.ts ./src/lib/n8n.ts
COPY --chown=node:node src/lib/worker-monitor.ts ./src/lib/worker-monitor.ts
COPY --chown=node:node scripts/n8n-worker.ts ./scripts/n8n-worker.ts
USER node
CMD ["node", "--import", "tsx", "scripts/n8n-worker.ts"]

FROM dependencies AS agent-worker
COPY --chown=node:node src/lib/agent-*.ts ./src/lib/
COPY --chown=node:node src/lib/worker-monitor.ts ./src/lib/
COPY --chown=node:node scripts/agent-worker.ts scripts/setup-agent.ts ./scripts/
USER node
CMD ["node", "--import", "tsx", "scripts/agent-worker.ts"]

FROM dependencies AS internal-worker
COPY --chown=node:node src/lib/worker-monitor.ts ./src/lib/
COPY --chown=node:node scripts/internal-worker.ts ./scripts/
USER node
CMD ["node", "--import", "tsx", "scripts/internal-worker.ts"]

FROM dependencies AS social-worker
COPY --chown=node:node src/lib/worker-monitor.ts src/lib/social-meta.ts ./src/lib/
COPY --chown=node:node scripts/social-worker.ts ./scripts/
USER node
CMD ["node", "--import", "tsx", "scripts/social-worker.ts"]
