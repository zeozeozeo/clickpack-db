# Use Go Alpine base image
FROM golang:1.24-alpine AS builder

RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o bot main.go

# Runtime stage
FROM alpine:latest

# Install system dependencies
RUN apk add --no-cache \
    gcc \
    p3-de \
    musl-dev \
    linux-headers \
    python3 \
    py3-pip \
    git \
    ffmpeg \
    p7zip \
    ca-certificates \
    bash

# Install Python dependencies
RUN pip3 install rarfile py7zr repro-zipfile --break-system-packages

# Create app user
RUN adduser -D -s /bin/bash appuser

# Set working directory
WORKDIR /workspace

# Copy built binary from builder stage
COPY --from=builder /app/bot /usr/local/bin/bot

# Change ownership of workspace to appuser
RUN chown -R appuser:appuser /workspace

# Switch to app user
USER appuser

# Set environment variables
ENV PYTHONPATH=/workspace
ENV PATH="/usr/local/bin:$PATH"

# Default command
CMD ["bot"]
