# ---------- Builder ----------
FROM golang:1.25.5-alpine AS builder

WORKDIR /build

RUN apk add --no-cache python3 build-base sqlite-dev

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
COPY static ./static
COPY templates ./templates
COPY data ./data
COPY init_checklist_db.py .

RUN CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o pokemmoraids

RUN python3 init_checklist_db.py

# ---------- Runtime ----------
FROM alpine:3.20

WORKDIR /app

RUN apk add --no-cache ca-certificates sqlite-libs

COPY --from=builder /build/pokemmoraids .
COPY --from=builder /build/*.sqlite .
COPY --from=builder /build/static ./static
COPY --from=builder /build/templates ./templates
COPY --from=builder /build/data ./data

EXPOSE 8080
CMD ["./pokemmoraids"]