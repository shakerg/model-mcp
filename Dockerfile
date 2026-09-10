FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim

ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/shakerg/model-mcp"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL io.modelcontextprotocol.server.name="io.github.shakerg/model-mcp"

ENV NODE_ENV=production
ENV MODEL_MCP_ENDPOINTS="http://host.docker.internal:11434,http://host.docker.internal:1234,http://host.docker.internal:8080"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY --from=build /app/dist ./dist

USER node
ENTRYPOINT ["node", "dist/index.js"]
