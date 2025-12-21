FROM golang:1.25.5-alpine

WORKDIR /app

RUN apk add --no-cache python3 py3-pip build-base

COPY go.mod go.sum /app/
COPY init_checklist_db.py /app/init_checklist_db.py
COPY static /app/static
COPY templates /app/templates
COPY *.go /app/
COPY data/*.json /app/data/

RUN CGO_ENABLED=0 GOOS=linux go build -o pokemmoraids

RUN python3 /app/init_checklist_db.py

EXPOSE 8080

CMD [ "./pokemmoraids" ]