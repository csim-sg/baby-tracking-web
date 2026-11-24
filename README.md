# Toddlebook

Printable 24-hour child care logs, rendered with TanStack Start. The hosted
domain will be `toddlebook.com` once DNS and deployment access are ready.

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

## CI and production deployment

CI on pull requests and pushes to `main`/`new-main` installs dependencies,
builds the app and image, and verifies the served production sheet against
the committed parity baseline. It installs the exact Chrome for Testing
158.0.8127.36 build used for that baseline (checksum-verified); the runner's
preinstalled browser may be a different version. CI never recaptures the
baseline.

`compose.prod.yaml` removes the published host port and routes through the
existing Docker host's external `ingress-network` and Traefik at
`toddlebook.com` (also `www.toddlebook.com`). Deployment runs **only after a
successful CI push to `main`** and only when the repository variable
`DEPLOY_ENABLED` is `true`. Changes on `new-main` are not deployed. Configure
the protected `production` GitHub environment before enabling this:

1. Point both domain records at the production Traefik host, verify HTTPS and
   that the Docker host has `ingress-network`. The domain currently resolves
   to a parking service; do not enable deployment until DNS is ready.
2. Set repository variables `DEPLOY_SSH_HOST` (the SSH-reachable Docker host)
   and `DEPLOY_SSH_USER` (an account with Docker access). Set secrets
   `DEPLOY_SSH_KEY` and `DEPLOY_SSH_KNOWN_HOSTS` (the **verified, pinned** SSH
   host-key line; do not trust a blind `ssh-keyscan` during deployment).
   The GitHub-hosted runner must be able to SSH to that host.
3. If runtime secrets become necessary, set `DEPLOY_AWS_ROLE_ARN` to an
   OIDC-assumable role with only `kms:Decrypt` for the KMS key in `.sops.yaml`.
   Restrict the role trust to this repository and the `production` environment.
   Encrypt a local `secrets/runtime.plain.env` (requires KMS Encrypt access):

   ```sh
   mkdir -p secrets
   sops --encrypt --filename-override secrets/runtime.enc.env \
     --input-type dotenv --output-type dotenv \
     secrets/runtime.plain.env > secrets/runtime.enc.env
   ```

   Commit **only** `secrets/runtime.enc.env`. The plaintext file is ignored.
   Deployment decrypts it into runner temporary storage and passes it to
   Compose; no runtime secrets file is required for the current, stateless app.

4. Enable `DEPLOY_ENABLED=true` only after the above checks. Require a
   reviewer on the `production` environment if deployments should need
   human approval. Keep `main` protected; the current styling migration is
   on `new-main`, and promoting it is a separate decision.

The deployment workflow is deliberately inactive without the enable variable.
It never changes or stops other Compose projects on the Docker host.
