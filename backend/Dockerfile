# The Express API as an image. It normally runs on Vercel; this is for hosting it
# yourself. Build from the repository root, where the lockfile is:
#
#   docker build -f backend/Dockerfile -t interviewmate-api .

FROM node:20-slim AS prune
WORKDIR /repo
RUN npm install -g turbo@2.11.13
COPY . .
# Keeps only the backend and the part of the root lockfile it needs.
RUN turbo prune backend --docker

FROM node:20-slim
WORKDIR /app
COPY --from=prune /repo/out/json/ .
RUN npm ci --omit=dev
COPY --from=prune /repo/out/full/ .
WORKDIR /app/backend

EXPOSE 5000

CMD ["node", "src/index.js"]
