FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN apk add --no-cache python3 make g++ && npm install --production

COPY . .
ENV PORT=8003
ENV DB_PATH=/data/dartmania.sqlite

EXPOSE 8003
CMD ["npm", "start"]
