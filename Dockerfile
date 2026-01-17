FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev \
  && apk del .build-deps

COPY . .
ENV NODE_ENV=production
ENV PORT=8003
ENV DB_PATH=/data/dartmania.sqlite

EXPOSE 8003
CMD ["npm", "start"]
