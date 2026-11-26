# Mirkomil PaaS — Node.js (generated; add your own Dockerfile to override)
FROM node:22-alpine
ENV PORT=8000
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build --if-present && npm prune --omit=dev && chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 8000
CMD ["npm", "start"]
