# Build stage
FROM golang:alpine AS builder

WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source
COPY . .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o hiatus .

# Runtime stage
FROM alpine:latest

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/hiatus .

# Expose port
EXPOSE 8080

# Run
CMD ["./hiatus", "--db", "/data/hiatus.db"]
