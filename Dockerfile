# Use official Node.js LTS
FROM node:20-slim

# Build timestamp — bump this to force a fresh Back4app rebuild
LABEL build.version="2026-07-28-v5"

# Set working directory
WORKDIR /app

# Copy package files first (for caching)
COPY package*.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

# Copy all source files
COPY . .

# Hugging Face Spaces uses port 7860 for container health checks
ENV PORT=7860
EXPOSE 7860

# Start the bot
CMD ["node", "index.js"]
