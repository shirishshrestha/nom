# Deploy

Push to `dev` → GitHub Actions builds the API image, pushes it to GHCR, then SSHes into the EC2
box and restarts the stack. `docker-compose.prod.yml` runs the **API + Neo4j**; Postgres and Redis
are the box's existing instances (reached via `host.docker.internal`).

## One-time setup

### 1. GitHub secrets

| Secret         | What                                                         |
| -------------- | ----------------------------------------------------------- |
| `EC2_HOST`     | EC2 public DNS / IP                                          |
| `EC2_USER`     | SSH user (e.g. `ubuntu`, `ec2-user`)                        |
| `EC2_SSH_KEY`  | Private key for that user                                    |
| `GHCR_USER`    | GitHub username (to `docker login` on the box)              |
| `GHCR_PAT`     | Classic PAT with `read:packages`                            |

> Alternative: make the GHCR package public and drop the `docker login` line in the workflow plus
> the two `GHCR_*` secrets.

### 2. EC2 box

```bash
# Docker + compose plugin must be installed.
mkdir -p ~/nom
# Copy .env.prod.example from the repo to ~/nom/.env and fill in real values.
```

### 3. Database bootstrap (once)

TypeORM app tables auto-create on the first API boot (`migrationsRun` in prod). Better Auth's
tables are separate — apply them once:

```bash
# Create the new Postgres DB on the box, then:
psql "<DATABASE_URL>" -f packages/database/better-auth/schema.sql
```

### 4. Host Postgres / Redis reachability

Both must accept connections from the Docker bridge, not just `127.0.0.1`:
- Postgres: `listen_addresses` includes the bridge, and `pg_hba.conf` allows the Docker subnet.
- `host.docker.internal` resolves to the host gateway (wired via `extra_hosts` in the compose file).

### 5. API port

`5000` is published. Open it in the security group if you hit the API directly, or point the box's
existing reverse proxy at `127.0.0.1:5000` (and change the compose `ports` to `127.0.0.1:5000:5000`).

## Monitoring

Nothing but port 5000 is exposed. Reach the data stores over an SSH tunnel:

```bash
# Neo4j Browser
ssh -L 7474:localhost:7474 -L 7687:localhost:7687 <user>@<ec2>
# → open http://localhost:7474, connect URL bolt://localhost:7687

# Postgres (pgAdmin / psql against localhost:5432)
ssh -L 5432:localhost:5432 <user>@<ec2>
```

## Deploy

Push to `dev`, or run the **Deploy API to EC2** workflow manually (`workflow_dispatch`).

```bash
# On the box, check status:
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```
