# ---------- Builder ----------
FROM golang:1.25.5-alpine AS builder

WORKDIR /build

RUN apk add --no-cache build-base

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
COPY static ./static
COPY templates ./templates

RUN CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o pokemmoraids

# ---------- Runtime ----------
FROM alpine:3.20

WORKDIR /app

RUN apk add --no-cache ca-certificates sqlite-libs

COPY --from=builder /build/pokemmoraids .
COPY --from=builder /build/static ./static
COPY --from=builder /build/templates ./templates

EXPOSE 8080

# Initialize databases and start the application
CMD ["sh", "-c", "./pokemmoraids"]