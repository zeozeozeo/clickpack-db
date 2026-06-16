# ==========================================
# Stage 1: Download and compile unrar
# ==========================================
FROM alpine:latest AS unrar-builder
RUN apk add --no-cache build-base

ADD https://www.rarlab.com/rar/unrarsrc-7.1.10.tar.gz /tmp/unrar.tar.gz
RUN tar -xzf /tmp/unrar.tar.gz -C /tmp && \
    cd /tmp/unrar && \
    make -f makefile && \
    install -v -m755 unrar /usr/local/bin/unrar

# ==========================================
# Stage 2: Build the Go Application
# ==========================================
FROM golang:1.26-alpine AS go-builder
RUN apk add --no-cache git

# Set working directory for the Go app
WORKDIR /app

# Copy and download Go dependencies (cached unless go.mod/go.sum changes)
COPY go.mod go.sum ./
RUN go mod download

# Copy source code and build the Go binary
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o bot main.go

# ==========================================
# Stage 3: Final Runtime Stage
# ==========================================
FROM alpine:latest

# Install system dependencies 
RUN apk add --no-cache \
    gcc \
    musl-dev \
    linux-headers \
    python3-dev \
    python3 \
    py3-pip \
    git \
    ffmpeg \
    p7zip \
    ca-certificates \
    curl \
    jq \
    libstdc++ \
    libgcc \
    bash

# Install Python dependencies
RUN pip3 install rarfile py7zr repro-zipfile --break-system-packages

# Create app user
RUN adduser -D -s /bin/bash appuser

# Set working directory
WORKDIR /workspace

# Copy binaries from their respective builder stages
COPY --from=go-builder /app/bot /usr/local/bin/bot
COPY --from=unrar-builder /usr/local/bin/unrar /usr/local/bin/unrar

# Change ownership of workspace to appuser
RUN chown -R appuser:appuser /workspace

# Switch to app user
USER appuser

# Set environment variables
ENV PYTHONPATH=/workspace
ENV PATH="/usr/local/bin:$PATH"

# Default command
CMD ["bot"]
