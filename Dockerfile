FROM golang:1.23-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY internal ./internal
COPY web ./web
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /follower .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates && mkdir -p /data && chown 1000:1000 /data
COPY --from=builder /follower /usr/local/bin/follower
USER 1000:1000
ENV DATA_DIR=/data HOST=0.0.0.0 PORT=3100
VOLUME /data
EXPOSE 3100
CMD ["/usr/local/bin/follower"]

