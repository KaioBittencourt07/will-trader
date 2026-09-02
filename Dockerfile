FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev
COPY backend/src ./backend/src
COPY engine ./engine
COPY data ./data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "backend/src/server.js"]
