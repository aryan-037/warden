FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=8080

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8080
CMD ["node", "src/server.js"]
