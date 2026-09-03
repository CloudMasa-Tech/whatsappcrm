# wacrm web app.
#
# Two stages: a build stage with dev dependencies, and a slim runtime
# that carries only what `next start` needs.
#
# NEXT_PUBLIC_* must be present at BUILD time
# ------------------------------------------
# Next.js inlines every NEXT_PUBLIC_* value into the client bundle when
# it compiles. Supplying them only at `docker run` is too late — the
# browser would receive `undefined` for the Supabase URL and every
# client-side query would fail with an opaque error. They are build
# args here, and docker-compose.yml passes them through.
#
# Secrets (SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, the gateway
# tokens) are deliberately NOT build args: they are read at runtime by
# server code only, and baking them into an image layer would leak them
# to anyone who can pull it.

FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_LOCALE=en
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE

# Fail the build rather than shipping an image whose client bundle
# points at nothing. This is cheap to check and expensive to discover
# in production.
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" || \
      (echo "ERROR: NEXT_PUBLIC_SUPABASE_URL build arg is required" && exit 1) && \
    test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" || \
      (echo "ERROR: NEXT_PUBLIC_SUPABASE_ANON_KEY build arg is required" && exit 1)

RUN npm run build

# ------------------------------------------------------------

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --chown=node:node package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./
COPY --from=build --chown=node:node /app/messages ./messages

RUN mkdir -p /app/.next/cache && chown -R node:node /app

EXPOSE 3000

# Unprivileged: this process holds the service-role key.
USER node

CMD ["npm", "start"]
