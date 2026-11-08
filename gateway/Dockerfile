# syntax=docker/dockerfile:1
FROM golang:1.24.13-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /opskit-gateway ./cmd/opskit-gateway

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /opskit-gateway /opskit-gateway
EXPOSE 8080
ENTRYPOINT ["/opskit-gateway"]
