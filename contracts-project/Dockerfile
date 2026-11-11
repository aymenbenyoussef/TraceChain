FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 8545
CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0"]
