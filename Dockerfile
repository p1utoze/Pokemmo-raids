# ---------- Builder ----------
FROM --platform=$BUILDPLATFORM golang:1.25.5-alpine AS builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /build

COPY go.mod go.sum ./

RUN go mod download

COPY *.go ./
COPY static ./static
COPY templates ./templates

RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -ldflags="-s -w" -o pokemmoraids

# ---------- Runtime ----------
FROM alpine:3.20

WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY --from=builder /build/pokemmoraids .
COPY --from=builder /build/static ./static
COPY --from=builder /build/templates ./templates

EXPOSE 8080

# Initialize databases and start the application
CMD ["sh", "-c", "./pokemmoraids"]