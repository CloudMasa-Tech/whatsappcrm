# The gateway is a long-lived process holding one WhatsApp WebSocket
# per project. It cannot run on serverless or shared hosting — see
# gateway/README.md for why, and for hosts that do work.

FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# No persistent volume: session credentials live in Supabase
# (whatsapp_session_keys, encrypted), so a replaced container
# reconnects rather than forcing every customer to re-scan.

ENV NODE_ENV=production
ENV PORT=8088
EXPOSE 8088

# Run unprivileged. This process holds credentials that can send as a
# customer's own WhatsApp number.
USER node

CMD ["node", "dist/index.js"]
