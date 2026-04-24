FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY src ./src
COPY tsconfig.json ./

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
