# Data Protection Impact Assessment — Aegis

**Status: DRAFT for completion by a Data Protection Officer.**

This document records what the system actually does, derived from the schema
and the code, and maps each risk to a control that is implemented and tested.
It is not legal advice. The sections marked **DECISION** cannot be answered by
engineering — they require the controller and a DPO.

| | |
|---|---|
| Controller | *(the customer operating the site — to be named)* |
| Processor | *(your company, if operating it on their behalf)* |
| System | Aegis vehicle access management |
| Version assessed | API 0.3.0 |
| Last reviewed | *(date)* |

---

## 1. Why a DPIA is mandatory here

Under GDPR Article 35(3)(c), a DPIA is **required** — not discretionary — for
"systematic monitoring of a publicly accessible area on a large scale".
Automated licence-plate recognition at a site entrance is systematic monitoring
by design.

A plate number is personal data: it is a unique identifier that a keeper
registry links to an identified person, and the controller does not need to
hold that registry for the data to be personal. Combined with timestamps and a
site, the system produces **movement patterns** — where a vehicle was, when,
and how often.

**DECISION for the DPO:** whether the monitored area is "publicly accessible"
and the scale "large" for this deployment. If either is arguable, document the
reasoning rather than assuming the DPIA is optional.

---

## 2. What the system does

```
camera → vision service → POST /alerts → confidence gate → guard decides → access log
                                              ↓
                                    human review queue
```

1. A camera frame is analysed; a plate region is detected and read.
2. Detection confidence × reading confidence gives a combined score.
3. The score determines the path:
   - **≥ 0.85** — an alert is raised and acted on without confirming the reading
   - **0.50 – 0.85** — an alert is raised **flagged for human confirmation**
   - **< 0.50** — refused; **not stored**, only counted
4. The plate is compared against the vehicle register; a mismatch is classified
   (`none`, `type`, `color`, `unregistered`).
5. The alert is streamed to on-duty guards.
6. **A guard decides** to approve or deny. That decision is written to the
   access log.

### Automated decision-making (Article 22)

**The system does not take automated decisions with legal or similarly
significant effect.** Verified in code: `POST /access-logs` — the only way an
access decision is recorded — requires an authenticated human guard or
administrator. There is no path by which a detection alone opens a barrier.

Two things must stay true for this to remain accurate:

- The guard console contains an **`autoApprove` toggle that is wired to
  nothing**. It is dead UI. If anyone implements it, the system acquires
  automated decision-making and this section becomes wrong. **Remove the
  control or treat implementing it as requiring a fresh DPIA.**
- If the system is ever integrated with a barrier that opens on an alert, Art
  22 applies and safeguards (human intervention, contest, explanation) become
  mandatory.

**DECISION:** confirm with the DPO whether the confidence gate's
"auto-accept ≥ 0.85" band constitutes automated *processing* requiring
transparency notices, even though the access *decision* remains human.

---

## 3. Data map

Derived from the live schema. Fields that identify or relate to a person are
marked **P**.

### Vehicle and detection data

| Table | Personal data | Purpose | Retention |
|---|---|---|---|
| `vehicles` | **P** `plate_number`, `plate_display`, make, model, colour, `owner_id` | The register alerts are compared against | Until deleted by an administrator |
| `alerts` | **P** `plate_number`, `confirmed_plate`, detected/registered attributes, confidences, `detector_name`/`version`, timestamps | Detections and their outcomes | **365 days** |
| `access_logs` | **P** `plate_number`, action, timestamp, `user_id`, `details` (raw detection payload) | Record of gate decisions | **365 days** |
| `alert_comments` | **P** `author_email`, free-text `body` | Operator notes on an alert | With the parent alert |

### Operator data

| Table | Personal data | Purpose | Retention |
|---|---|---|---|
| `users` | **P** `email`, `full_name`, `hashed_password` (Argon2id), role, `last_login_at` | Authentication and authorisation | Until deactivated; rows are retained, not deleted, to preserve the audit trail |
| `refresh_tokens` | SHA-256 digest only | Session continuity | **30 days** |
| `audit_logs` | **P** `actor_email`, `ip_address`, `user_agent`, `details` (may embed a plate) | Record of who accessed or changed what | **730 days** |

### Not personal data

`sites`, `attribute_mismatch_rules` — configuration only.

### Notable properties

- **Plates are normalised** (`AB-12 CD` → `AB12CD`) for matching; the typed
  form is kept for display.
- **Registered attributes are snapshotted onto each alert**, so later edits to
  a vehicle cannot rewrite why an alert fired. This is a data-integrity
  property that matters if a decision is ever challenged.
- **Audit logs deliberately outlive operational data.** They are the record
  produced when a subject or regulator asks who accessed what.
- **Free-text fields** (`alert_comments.body`) can contain anything an operator
  types. Train staff: this field is disclosed in a subject access request.

---

## 4. Purpose and lawful basis

| Purpose | Necessary? |
|---|---|
| Controlling vehicle access to a site | Core purpose |
| Detecting unregistered or mismatched vehicles | Core purpose |
| Retaining a decision record for dispute and audit | Supports the above |
| Measuring detector accuracy (`detector_version`, correction rate) | Quality assurance; uses data already held |

**DECISION — lawful basis (Art 6).** Most site-security deployments rely on
**legitimate interests (6(1)(f))**, which requires a documented Legitimate
Interests Assessment balancing the controller's security interest against the
rights of everyone whose plate is captured — including visitors who never
consented and cannot realistically object.

Consent (6(1)(a)) is **not** viable: a driver approaching a barrier cannot give
freely-given consent, and refusing would mean being denied entry.

**No special-category data (Art 9) is processed**, provided the deployment does
not infer anything about the driver. Note that plate data at, for example, a
place of worship or a clinic can reveal special-category information by
inference — a siting question, not a software one.

---

## 5. Necessity and proportionality

Arguments the controller can make, all backed by implemented behaviour:

- **Data minimisation.** Reads below the confidence floor are **refused and
  never stored** — the system declines to keep data it cannot rely on. Only
  plate, attributes, confidence, and timestamp are held; no images are retained
  by the API.
- **Storage limitation.** Every class has an explicit lifetime enforced by an
  idempotent purge job, not by intention.
- **Accuracy.** Low-confidence reads are routed to a human before being
  trusted, and corrections are recorded. The correction rate is a *measured*
  error rate rather than a vendor claim.
- **Purpose limitation.** Role-based access confines plate data to those who
  need it; a plain user sees only their own vehicles and history.

**Open question — camera images.** The API stores no images. Whether the vision
service or the cameras themselves retain frames is a **deployment** question,
and retained footage is a far larger processing operation than the plate text.
**DECISION:** confirm and document what the cameras keep.

---

## 6. Risks and controls

| # | Risk to data subjects | Control | Status |
|---|---|---|---|
| 1 | Misidentification denies access or wrongly flags a person | Confidence gating; low-confidence reads go to a human before being trusted; corrections audited | Implemented, tested |
| 2 | Excessive retention builds a movement history | Per-class retention with an automated purge; audit logs outlive operational data by design | Implemented, tested |
| 3 | Unauthorised access to plate data | Server-side RBAC on every endpoint; results scoped by role, not merely gated | Implemented, tested |
| 4 | Compromise of a camera host yields broad access | Vision service runs as a **`service` role that may only publish detections** — it cannot read the register, list alerts, confirm plates, or record an access decision | Implemented, tested |
| 5 | Credential theft | Argon2id; 15-minute access tokens; rotating refresh tokens stored only as digests; login throttling; uniform failure responses that do not reveal whether an account exists | Implemented, tested |
| 6 | Undetected misuse by an insider | Audit log covers **reads** of plate data, not only writes, with actor and IP | Implemented, tested |
| 7 | Data loss | Encrypted backups with a verified restore path, exercised in CI | Implemented, tested |
| 8 | Backup compromise | Asymmetric encryption — the backup host holds only a public key and cannot read its own backups | Implemented |
| 9 | Erasure destroys the audit trail | Erasure **anonymises** rather than deletes: the identifying value is replaced with a random, irreversible tombstone; the event survives | Implemented, tested |
| 10 | Function creep — data reused for a new purpose | Not a technical control | **DECISION: policy** |
| 11 | Transparency — drivers unaware of processing | Not a technical control | **DECISION: signage and privacy notice** |

### Residual risks

- **Backups sit outside the erasure path.** A dump taken before an erasure
  still contains the plate. Either keep backup retention shorter than the
  erasure SLA, or document a re-erasure step after any restore. **DECISION.**
- **Free-text comments** can contain anything, including special-category
  information a guard types. Mitigate by training, not by code.
- **Detector accuracy is unmeasured in production.** It has been measured only
  on public data, not on this site's cameras. Until it is measured on local
  footage (`python -m app.evaluate`) and the correction rate is observed, no
  accuracy figure should be quoted to anyone.
- **A `%plate%` search over audit payloads is a sequential scan.** Acceptable
  now; if subject requests become frequent, add the documented trigram index.

---

## 7. Subject rights

| Right | How it is served |
|---|---|
| Access (Art 15) | `python -m app.cli export-subject --plate "AB12 CD"` — returns the vehicle record, every alert, every access log, **and the audit entries showing who viewed the data** |
| Erasure (Art 17) | `python -m app.cli erase-subject --plate "AB12 CD" --confirm "AB12 CD"` — anonymises across every table; the erasure is itself audited and deliberately does not record the plate |
| Rectification (Art 16) | Administrators can correct the register; a misread plate is corrected through the review queue, which re-classifies it against the register |
| Objection (Art 21) | **DECISION: process** — erasure tooling exists; who assesses an objection does not |
| Portability (Art 20) | Export is JSON. Applies only if the basis is consent or contract; under legitimate interests it does not |

**DECISION:** the response process — who receives a request, how identity is
verified (a plate alone does not prove someone is the keeper), and the one-month
statutory deadline.

---

## 8. Actions before go-live

| # | Action | Owner |
|---|---|---|
| 1 | Complete the Legitimate Interests Assessment | DPO |
| 2 | Set retention periods from this assessment, not the defaults | DPO |
| 3 | Publish a privacy notice and install signage at every monitored entrance | Controller |
| 4 | Confirm and document what the cameras themselves retain | Controller |
| 5 | Decide the backup-versus-erasure reconciliation | DPO |
| 6 | Remove or formally scope the dead `autoApprove` control | Engineering |
| 7 | Define the subject-request process and identity verification | Controller |
| 8 | Record processor/controller roles and a data processing agreement | Both |
| 9 | Review after the real detector is deployed — accuracy changes the risk profile | Both |

---

## 9. Evidence

Claims here are verifiable, not aspirational:

- Retention, erasure, and audit behaviour: `backend/api_server/tests/test_retention_privacy.py`
- Role confinement including the service account: `backend/api_server/tests/test_resources.py`
- Authentication controls: `backend/api_server/tests/test_auth.py`
- Confidence gating and review queue: `backend/api_server/tests/test_review.py`
- Backup restore verified on every push: `.github/workflows/ci.yml`
- Operational procedures: [operations.md](operations.md)
