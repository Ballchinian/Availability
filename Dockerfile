# one image, one service: build the svelte site, then run the bot+api that
# serves it. works on railway, fly, render or any plain container host.

# stage one builds the static site
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# stage two runs the backend and carries the built site along
FROM node:22-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./

# the backend looks for the built site at ../web/dist, so drop it there
COPY --from=web-build /app/web/dist /app/web/dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]
