# Stage 1: Build the frontend, and install server dependencies
FROM node:22 AS builder

WORKDIR /app

# Copy all files from the current directory
COPY . ./
RUN echo "API_KEY=PLACEHOLDER" > ./.env
RUN echo "GEMINI_API_KEY=PLACEHOLDER" >> ./.env

# Install server dependencies
WORKDIR /app/server
RUN npm install

# Install dependencies and build the frontend
WORKDIR /app
RUN mkdir dist
RUN bash -c 'if [ -f package.json ]; then npm install && npm run build; fi'


# Stage 2: Build the final server image
FROM node:22

WORKDIR /app

# Copy server files into a server/ directory
COPY --from=builder /app/server ./server
# Explicitly copy node_modules to ensure they are present in the final image
COPY --from=builder /app/server/node_modules ./server/node_modules
# Copy built frontend assets from the builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 8080

CMD ["node", "server/server.js"]
