# Use Debian 12 (bookworm) - has latest ffmpeg
FROM node:20-bookworm

# Install system deps: ffmpeg + sharp deps + git
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    python3 \
    build-essential \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Verify ffmpeg installed
RUN ffmpeg -version && ffprobe -version

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install deps
RUN npm install --omit=dev

# Copy rest
COPY . .

# Create needed folders
RUN mkdir -p auth_info media temp database

# Fix permissions
RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "index.js"]