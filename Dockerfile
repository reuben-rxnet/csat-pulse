FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p outbox discover && chown -R node:node /app
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
