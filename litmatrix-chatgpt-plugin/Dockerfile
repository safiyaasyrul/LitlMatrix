FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN npm install --no-save typescript vite vite-plugin-singlefile cross-env tsx concurrently @types/node @types/express @types/cors --no-audit --no-fund && npm run build
EXPOSE 3001
CMD ["npm", "run", "serve"]
