FROM node:22-alpine

WORKDIR /app

# Install build deps for better-sqlite3 + sharp + HEIC support
RUN apk add --no-cache python3 make g++ vips-dev fftw-dev jpeg-dev libpng-dev libwebp-dev tiff-dev libheif-dev imagemagick

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/uploads /app/data

EXPOSE 3200

CMD ["node", "server.js"]
