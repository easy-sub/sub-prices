FROM node:20-alpine AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/build ./build
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "build/server.cjs"]
