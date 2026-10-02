# Operations

Backups, data retention, and subject-rights requests.

## Backups

```bash
BACKUP_ENCRYPT_TO=ops@example.com \
  scripts/backup.sh ./backups        # encrypted dump + SHA-256
scripts/verify-backup.sh ./backups/aegis-<stamp>.dump.gpg
scripts/restore.sh ./backups/aegis-<stamp>.dump.gpg "postgresql://user:pw@host/db"
```

`backup.sh` reads `DATABASE_URL` from the environment or `.env`, writes a
compressed custom-format dump, encrypts it, records a checksum over the stored
artefact, optionally copies it off-box, and prunes files older than
`BACKUP_RETAIN_DAYS` (default 30).

### Encryption

```bash
BACKUP_ENCRYPT_TO=ops@example.com        # gpg key id, uid, or fingerprint
BACKUP_ENCRYPT_TO=age1qz...              # or an age recipient
```

Encryption is **asymmetric on purpose**: the backup host holds only the public
key, so an attacker who compromises it cannot read the backups it produced.
Keep the private key somewhere the backup host cannot reach — a backup you
cannot decrypt in an emergency is as useless as no backup, so store it with
the same care as any other recovery credential and test the restore path.

The plaintext dump is shredded once the ciphertext exists, and decryption
during restore goes to a private temp file that is shredded on exit.

Without `BACKUP_ENCRYPT_TO` the script warns loudly and writes plaintext. A
dump contains every plate you have ever seen.

### Off-box copy

```bash
BACKUP_UPLOAD_CMD='aws s3 cp {} s3://your-bucket/aegis/'
BACKUP_UPLOAD_CMD='rclone copyto {} remote:aegis/'
```

`{}` is replaced with the file path; both the artefact and its checksum are
sent. A backup on the same disk as the database is not a backup.

**Schedule `verify-backup.sh`, not just `backup.sh`.** It restores into a
throwaway database, counts rows, fails if the restored copy has no users, and
drops the scratch database again. A backup nobody has restored is a guess. CI
runs this on every push against a real PostgreSQL.

`restore.sh` requires the target URL as an explicit argument. It deliberately
does not default to `DATABASE_URL`, so a mistyped command cannot overwrite
production.

### Targets to agree with the customer

| | Meaning | Current |
|---|---|---|
| RPO | Acceptable data loss | = backup interval (nightly ⇒ up to 24 h) |
| RTO | Acceptable downtime | restore time + redeploy |

Nightly logical dumps are a reasonable starting point. If the customer cannot
lose a day of gate history, move to continuous archiving (WAL-E/pgBackRest) —
`pg_dump` cannot give you point-in-time recovery.

Store backups **off the machine that holds the database**, encrypted at rest.
A dump contains every plate you have ever seen.

## Data retention

Plate data is personal data. Keeping it forever is a storage-limitation
problem under GDPR, so every class has an explicit lifetime:

| Class | Default | Why |
|---|---|---|
| `audit_logs` | 730 days | The record of who accessed what — what you produce when challenged |
| `access_logs` | 365 days | Operational gate history |
| `alerts` | 365 days | Detections and their outcomes |
| `refresh_tokens` | 30 days | No value once expired or revoked |

Audit logs outlive operational data **on purpose**. Set all four from your
DPIA; the defaults are a starting point, not legal advice.

```bash
python -m app.cli purge --dry-run    # report only
python -m app.cli purge              # delete

docker compose --profile tools run --rm purge
```

The purge is idempotent, deletes in batches of 1000 so it will not hold a long
transaction open against a live gate, and writes a `retention.purged` audit
entry when it removes anything. Run it from cron, a systemd timer, or a
Kubernetes CronJob — daily is fine.

## Subject rights

### Access request

```bash
python -m app.cli export-subject --plate "AB12 CD" --out subject.json
```

Returns the vehicle record, every alert, every access log, **and the audit
entries** — a data subject is entitled to know who looked at their data, not
merely that it was recorded.

### Erasure

```bash
python -m app.cli erase-subject --plate "AB12 CD" --confirm "AB12 CD" \
  --reason "SAR-2026-001"
```

`--confirm` must repeat the plate, so this cannot fire from a mistyped or
shell-expanded argument. The command prints what it is about to touch first.

**Rows are anonymised, not deleted.** The identifying value is replaced with a
random tombstone (`ERASED-…`); the row survives. Deleting them would punch
holes in the audit trail — the record that a decision was made at a gate at a
given time is itself a legal artefact, and destroying it to satisfy erasure
trades one compliance failure for another.

The tombstone is **random, not a hash of the plate**. Plate numbers are
low-entropy: anyone holding hashed plates could enumerate the whole plate space
and reverse them, which would make the erasure cosmetic.

The erasure is itself audited, and that record deliberately does not contain
the plate — writing it there would recreate the data just removed.

> Backups are outside the erasure path. A dump taken before an erasure still
> contains the plate. Either keep backup retention shorter than your erasure
> SLA, or document a re-erasure step after any restore. Agree which with the
> customer's DPO.

## Visits: who is on site

With cameras tagged `|entry` and `|exit` (see
[camera-installation.md](camera-installation.md#5-connecting-the-camera-to-aegis)),
an entry read opens a **visit** and the next exit read of the same plate closes
it:

- **Guard console:** the **On site now** panel lists vehicles inside and how
  long they have been there. A visitor still inside after their pass ended is
  flagged **Pass ended**.
- **Admin dashboard:** the **Visits** tab shows recent visits, their lengths,
  and the median stay.
- **Edge cases:**
  - A second entry read while a vehicle is inside is the same visit.
  - An exit with no entry on record is kept as "entry not seen".
  - A guard **denying** the vehicle at the entry cancels its visit, because it
    never came in.
- **Records:** visits are personal data. Viewing them is audited, they are
  purged after `RETENTION_VISIT_DAYS` (365), and subject export and erasure by
  plate include them.

## Watchlist

Administrators flag plates on sight in the admin dashboard's **Watchlist**
tab: a plate and a reason (for example *"Reported stolen 30 Sep, call
police"*). Guards can see the list.

- **At the gate:** a camera read of a watched plate is a **WATCHLIST** alert,
  which outranks every other verdict, even a registered vehicle that matches,
  because a stolen registered car looks exactly like that. The guard console
  shows the reason in a red banner at the top of the decision prompt.
- **Paging:** the `AegisWatchlistHit` rule pages the critical channel (Discord)
  within about a minute. Prometheus only counts hits by alert type, so **the
  plate never leaves the site**; the page tells the on-call person to open the
  guard console. The rule has a test (`monitoring/alerts.test.yml`) run in CI.
- **Records:** adding and removing entries are audited. Removed entries are
  kept for `RETENTION_WATCHLIST_DAYS` (365), then purged. Subject export and
  erasure by plate include watchlist entries.

## Visitor passes

Residents add expected visitors in the user portal (**My visitors**): plate,
name, a time window of at most 30 days, and an optional note for the guard.
Guards and administrators can issue passes for any host through the API. A
camera read of the plate inside the window shows the guard **Expected visitor**
with the name, host and end time, in place of "Unregistered plate". The guard
still decides: a pass is never grounds for opening the barrier on its own.

A pass names a visitor, so it is personal data:

- **Who can see it:** residents see and cancel only the passes they host.
- **Audit:** creating, listing and cancelling passes are audited.
- **Subject rights:** export and erasure by plate include passes; erasure
  removes the visitor's name and notes as well as the plate.
- **Retention:** passes are deleted `RETENTION_VISITOR_PASS_DAYS` (90) days
  after they end. The alerts they covered keep their own retention.

## Monitoring

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Prometheus on 127.0.0.1:9090, Grafana on 127.0.0.1:3030 with the *Aegis —
Overview* dashboard provisioned. Both bind to loopback: Prometheus has no
authentication and its data describes your traffic in detail. Put them behind
your VPN or an authenticating proxy, never on a public port.

Nine alert rules ship in `monitoring/alerts.yml`, validated by `promtool` in
CI. Each carries a description saying what it means and what to check, because
an alert that fires at 03:00 without a next step becomes noise the team learns
to ignore.

Set `METRICS_TOKEN` on the API and uncomment the `authorization` block in
`monitoring/prometheus.yml` to authenticate scrapes.

### Routing alerts to a human

Prometheus evaluating rules is only half the job — without routing, a firing
alert is a red row in a web UI nobody is watching. Alertmanager
(127.0.0.1:9093) routes by severity:

| Severity | Wait | Repeat | Meaning |
|---|---|---|---|
| `critical` | 10s | 1h | Gates are not working; page someone now |
| `warning` | 30s | 12h | Working hours, not 03:00 |

Alerts of every severity go to one Discord channel. Nothing is delivered until
the webhook URL is set:

1. In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy
   Webhook URL.
2. Save it where Alertmanager reads it (the file is gitignored; the URL is a
   secret, since anyone holding it can post to the channel):

   ```bash
   printf '%s' 'https://discord.com/api/webhooks/...' > monitoring/discord-webhook-url
   ```

3. Restart Alertmanager (`docker compose -f docker-compose.yml -f
   docker-compose.monitoring.yml restart alertmanager`) and send the test alert
   below.

Create the file before starting the stack: otherwise Docker creates a directory
in its place and Alertmanager cannot send anything.

Two inhibition rules prevent double-paging: if `AegisApiDown` fires, its error
rate and latency alerts are suppressed as consequences rather than separate
incidents; and a critical alert suppresses the warning of the same name.

**Test the path before you need it:**

```bash
curl -X POST http://127.0.0.1:9093/api/v2/alerts -H 'Content-Type: application/json' -d '[{
  "labels": {"alertname":"AegisPagingTest","severity":"critical","service":"api"},
  "annotations": {"summary":"Paging test — ignore",
                  "description":"Verifying the on-call path end to end."}
}]'
```

If nothing reaches a human within a minute, the routing is wrong. Finding that
out during an incident is the expensive way.

Worth alerting on:

| Signal | Why |
|---|---|
| `aegis_login_attempts_total{outcome="failed"}` rate | Credential stuffing |
| `aegis_http_requests_total{status=~"5.."}` rate | Service degradation |
| `aegis_review_queue_depth` | Detections piling up unreviewed |
| `aegis_plate_confirmations_total{outcome="corrected"}` ratio | Detector accuracy drift |
| `aegis_websocket_connections` at zero during a shift | Guards are not receiving alerts |

That last one is the quiet failure: everything looks healthy while nobody is
actually being notified.
