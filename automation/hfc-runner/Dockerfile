FROM mcr.microsoft.com/playwright:v1.47.0-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm install -D typescript tsx @types/node
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/server.js"]
