FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production || npm install --only=production

COPY . .

EXPOSE 5004

ENV NODE_ENV=production

# Run as non-root for security (node user ships with the base image)
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:5004/health || exit 1

CMD ["node", "server.js"]
