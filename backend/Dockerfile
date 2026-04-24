FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/node_modules ./node_modules

COPY server.js ./
COPY package*.json ./

LABEL org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.authors="DallasJr" \
      org.opencontainers.image.source="https://github.com/DallasJr/taskflow"

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

USER appuser

EXPOSE 3001

CMD ["node", "server.js"]