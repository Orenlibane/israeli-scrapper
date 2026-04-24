FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# bust=20260425
ARG API_URL=http://localhost:3000
RUN sed -i "s|__API_URL__|${API_URL}|g" src/environments/environment.production.ts

RUN npm run build

# ── Serve stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist/web/browser ./dist

EXPOSE 4200

CMD ["sh", "-c", "serve dist -l ${PORT:-4200} --no-clipboard"]
# bust=202604250118
# bust=202604250131
# bust=202604250159
