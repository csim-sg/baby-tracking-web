# Tiny Daybook

Printable baby tracking sheets, rendered with TanStack Start.

## Local development

```sh
npm install
npm run dev
```

## Docker Compose

Build and start the production SSR container:

```sh
docker compose up --build -d
```

Open `http://localhost:3000`. To stop it:

```sh
docker compose down
```

To use another host port, change the left side of `3000:3000` in `compose.yaml`.
