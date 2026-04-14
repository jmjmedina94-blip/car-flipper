FROM node:22-alpine

WORKDIR /app

# Install build deps for better-sqlite3 + image processing
RUN apk add --no-cache python3 make g++ imagemagick

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# /app/uploads will be a Railway Volume mount in production
# /app/data is for SQLite in dev (production uses PostgreSQL)
RUN mkdir -p /app/uploads /app/data

EXPOSE 3200

CMD ["node", "server.js"]
