# Oracle Cloud deployment

This package runs Hospital AI OS on one Oracle Linux or Ubuntu VM, stores the SQLite database on persistent block storage, and puts automatic HTTPS in front through Caddy. It deliberately runs a single application instance because this release uses SQLite and in-process live updates.

Oracle encrypts boot volumes, block volumes, and their backups at rest with AES-256 by default. The application key separately encrypts stored recordings and exports; the SQLite database relies on the encrypted Oracle volume and strict VM access.

## Before you start

- Create an Oracle VM with a reserved public IP and persistent boot/block volume.
- Point a DNS name such as `hospital.example.in` to that IP.
- In the Oracle network security list and the VM firewall, allow inbound TCP **22**, **80**, and **443**. Restrict port 22 to your own office/VPN addresses.
- Install Git and Docker Engine with the Compose plugin from Docker's official repository.

Keep real patient data out until the hospital has approved residency, retention, access, incident response, and backup policies. Oracle Always Free capacity is limited and availability is not guaranteed; use a paid VM or the hospital's own infrastructure for a production SLA.

## Deploy

```bash
sudo mkdir -p /opt/hospital-ai-os
sudo chown "$USER":"$USER" /opt/hospital-ai-os
git clone https://github.com/mayurr99/hospital-AI-OS.git /opt/hospital-ai-os
cd /opt/hospital-ai-os

cp .env.oracle.example .env.oracle
openssl rand -hex 32
```

Edit `.env.oracle`, set `DOMAIN`, and paste the generated value into `STORAGE_ENCRYPTION_KEY`. Store a second copy of that key in a password manager. Add the Resend values later if email OTP is required.

```bash
chmod +x deploy/oracle/deploy.sh deploy/oracle/backup.sh
./deploy/oracle/deploy.sh
```

Caddy obtains and renews the TLS certificate. Open `https://your-domain/api/health`; HTTP 200 means the process and database are reachable. A `degraded` status is expected until the first successful backup.

## Backups

Run a verified local snapshot every night:

```bash
sudo crontab -e
15 2 * * * /opt/hospital-ai-os/deploy/oracle/backup.sh >> /var/log/hospital-ai-backup.log 2>&1
```

The snapshots appear under `.oracle-backups`. Copy them to a different account or storage service. Also schedule Oracle volume backups. Test a restore before entering real records; local snapshots on the same VM do not protect against account or VM loss.

## Update and rollback

Take a backup, pull the release, rebuild, and verify health:

```bash
cd /opt/hospital-ai-os
./deploy/oracle/backup.sh
git pull --ff-only
./deploy/oracle/deploy.sh
docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml logs --tail=100 app
```

For a code rollback, check out the previous known-good commit and run the deploy script again. To restore data, choose a timestamp under `.oracle-backups`, stop the application, run the restore in a one-off container, and start it again:

```bash
docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml stop app
docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml run --rm app npm run restore -- /backups/REPLACE_WITH_TIMESTAMP --yes
docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml up -d
```

The restore tool verifies the snapshot and preserves the database it replaces.

## Production checks

- Keep `SEED_DEMO=0`.
- Keep authenticator MFA unless the hospital specifically requires email login codes.
- Never expose port 3000 publicly; only Caddy should receive internet traffic.
- Keep the Oracle account behind MFA and give VM access only to named operators.
- Review `/admin/security`, the audit trail, and `/api/health` after each deployment.
- Run dependency/security and disaster-recovery tests for every release.
