FROM node:20-alpine
RUN apk add --no-cache curl su-exec
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
