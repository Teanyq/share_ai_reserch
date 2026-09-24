# ゲームサーバ + Web 版クライアント配信（Fly.io 用）
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
