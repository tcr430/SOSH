# Postiz Infrastructure

[Postiz](https://postiz.com) is the self-hosted social publishing backend used by SOSH
(ADR 0002). SOSH talks to Postiz via its REST API — `POSTIZ_BASE_URL` and `POSTIZ_API_KEY`
in `.env.local` point to whichever Postiz instance is running.

This directory contains everything needed to run Postiz locally (Docker Compose) and deploy
it to a Hetzner VPS (Caddy + Docker Compose).

---

## Local Setup

1. Copy the example env file and fill in the values:
   ```
   cp infra/.env.example infra/.env
   ```
   Edit `infra/.env` — at minimum change `POSTGRES_PASSWORD` and `POSTIZ_JWT_SECRET`.

2. Start Postiz (Postgres + Redis + app):
   ```
   npm run postiz:up
   ```

3. Access the Postiz admin UI at `http://localhost:5000`.

4. Create an API key in the Postiz admin UI under **Settings → API Key**.

5. Install [ngrok](https://ngrok.com) and expose port 5000 for OAuth callbacks during development:
   ```
   ngrok http 5000
   ```
   Copy the generated `https://` URL — you will need it when registering OAuth apps on
   LinkedIn, X, Instagram, Facebook, and Threads developer portals.

6. Add the following to your SOSH `.env.local`:
   ```
   POSTIZ_BASE_URL=http://localhost:5000
   ```

7. Add the API key from step 4 to your SOSH `.env.local`:
   ```
   POSTIZ_API_KEY=<key from step 4>
   ```

---

## Hetzner Production

1. Provision a Hetzner Cloud VPS — Ubuntu 22.04, minimum 2 GB RAM (CX21 or larger).

2. SSH into the VPS and install Docker and Docker Compose:
   ```
   curl -fsSL https://get.docker.com | sh
   ```

3. Copy the `infra/` directory to the VPS and fill in the production `.env`:
   ```
   scp -r infra/ root@<vps-ip>:/opt/sosh-postiz/
   ssh root@<vps-ip>
   cd /opt/sosh-postiz
   cp .env.example .env
   # Edit .env with production values
   ```

4. Copy `infra/caddy/Caddyfile.example` to `infra/caddy/Caddyfile` and replace
   `your-postiz-domain.example.com` with your real domain. Point the domain's DNS
   A record to the VPS IP before starting Caddy (Let's Encrypt requires DNS to resolve).

5. Start all services:
   ```
   docker-compose up -d
   ```

6. In Vercel, set `POSTIZ_BASE_URL` to your VPS domain (e.g. `https://postiz.yourcompany.com`)
   and redeploy.

7. Update the OAuth callback URLs in each platform's developer portal to use the ngrok URL
   from local dev → replace with `https://postiz.yourcompany.com` for production.

---

## Useful commands

```bash
npm run postiz:up      # Start all services in the background
npm run postiz:down    # Stop all services
npm run postiz:logs    # Stream live logs from all services
```
