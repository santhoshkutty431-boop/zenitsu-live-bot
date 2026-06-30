# Use official Node.js LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first (for caching)
COPY package*.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

# Copy all source files
COPY . .

# Cloud Run requires port 8080 for health checks
ENV PORT=8080

# Start the bot
CMD ["node", "index.js"]
