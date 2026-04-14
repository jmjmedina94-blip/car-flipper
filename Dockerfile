FROM node:22-alpine

WORKDIR /app

# Install build deps for better-sqlite3 + image processing
RUN apk add --no-cache python3 make g++ imagemagick

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/uploads /app/data

EXPOSE 3200

CMD ["node", "server.js"]
