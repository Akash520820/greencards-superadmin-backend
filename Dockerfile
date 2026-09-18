FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production || npm install --only=production

COPY . .

EXPOSE 5004

ENV NODE_ENV=production

CMD ["node", "server.js"]
