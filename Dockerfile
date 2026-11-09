# Stage 1: build the frontend
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_FCM_VAPID_KEY=""
ENV VITE_FCM_VAPID_KEY=$VITE_FCM_VAPID_KEY
RUN npm run build

# Stage 2: production runtime
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY firebase-applet-config.json ./
USER node
# Cloud Run injects PORT; the server honours it (defaults to 3000)
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
