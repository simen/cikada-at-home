FROM node:20-alpine

WORKDIR /app

# Copy the mock agent server
COPY server.js .

# Create some sample files in workspace
RUN mkdir -p /workspace && \
    echo "Hello from test" > /workspace/hello.txt && \
    echo "Another file" > /workspace/readme.md

EXPOSE 8080

CMD ["node", "/app/server.js"]
