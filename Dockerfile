# Sonora — zero-dependency Node app, so this image is tiny and builds instantly.
FROM node:20-alpine

WORKDIR /app

# No `npm install` step: Sonora has no dependencies. Copying source IS the build.
COPY . .

# Persist the database outside the image layer.
ENV SONORA_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node

# Container platforms route traffic to 0.0.0.0; NODE_ENV=production already
# switches the bind address, this is just belt and braces.
ENV HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
