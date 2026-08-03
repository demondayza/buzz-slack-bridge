ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d
FROM ${NODE_IMAGE} AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
RUN mkdir -p /data && chown node:node /data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json

USER node
EXPOSE 8787
CMD ["node", "dist/index.js"]
