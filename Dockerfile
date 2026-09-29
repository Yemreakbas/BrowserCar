FROM node:22-alpine AS runner

WORKDIR /app

# Copy shared code and server dependency definitions
COPY shared ./shared
COPY server/package*.json ./server/

# Install server production dependencies
WORKDIR /app/server
RUN npm ci --omit=dev

# Copy server application source code and TypeScript config
COPY server/src ./src
COPY server/tsconfig.json ./

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
ENV CORS_ORIGIN=*

EXPOSE 3001

# Health check using HTTP GET on /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/health || exit 1

# Start the server using production tsx
CMD ["npx", "tsx", "src/server.ts"]
