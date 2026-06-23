# Backend: Express + Socket.IO + sql.js (pure-JS deps, no native build step).
# Build context is the REPO ROOT, because backend code requires ../../../shared.
FROM node:20-slim

WORKDIR /app

# shared/ is imported by the backend via ../../../shared/regulations
COPY shared ./shared

# Install deps first so this layer caches when only source changes
COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

# App source (data/ and public/sprites/ are excluded via .dockerignore and
# provided at runtime as volumes)
COPY backend/ ./

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "src/app.js"]
