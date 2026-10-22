FROM node:22-alpine

WORKDIR /app

# Keep the root package metadata: shared source directories use native ESM.
COPY package.json ./package.json
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# Runtime dependencies imported by backend/src/server.js and its route graph.
COPY backend/src ./backend/src
COPY backend/config ./backend/config
COPY engine ./engine
COPY data ./data
COPY context ./context
COPY learning ./learning
COPY paper ./paper
COPY backtest ./backtest
COPY dashboard ./dashboard

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "backend/src/server.js"]
