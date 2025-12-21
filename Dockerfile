FROM golang:1.25.5-alpine

WORKDIR /app

RUN apk add --no-cache python3 py3-pip

COPY go.mod go.sum /app/
COPY init_checklist_db.py /app/init_checklist_db.py
COPY static /app/static
COPY templates /app/templates
COPY *.go /app/
COPY data/*.json /app/data/

RUN go build -o pokemmoraids

RUN python3 /app/init_checklist_db.py

CMD [ "./pokemmoraids" ]