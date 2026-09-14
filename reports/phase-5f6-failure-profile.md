# Phase 5F.6 — Failure Profile Report

**Generated:** 2026-09-13 · **Database:** `10.100.14.216/kol` (production KOL server)
**Mode:** READ-ONLY — session pinned with `default_transaction_read_only = on` inside
`BEGIN READ ONLY … ROLLBACK`, plus `PGOPTIONS='-c default_transaction_read_only=on'`.
No writes, no Apify calls, no scheduler execution, no schema or code changes.

---

## Executive summary

Only **2 of 5,229** currently-eligible accounts carry any scheduler-owned failure
history, and both carry the legacy status `failed` rather than one of the seven
taxonomy codes. The failure taxonomy that a cooldown policy would key on has
**zero production coverage** among eligible accounts.

**Verdict: OPTION B — evidence is insufficient; product policy must be defined
before technical implementation.**

---

## 1. Current eligible pool

Using the exact predicate from `scheduler_engine.select_profile_targets()` —
platform match, non-empty username, not in `EXCLUDED_USERNAMES`,
`NOT EXISTS` L0 profile, `NOT EXISTS` L0 post.

| Platform | Eligible |
|---|---:|
| Instagram | 2,350 |
| TikTok | 2,879 |
| **Total** | **5,229** |

### Classification against scheduler-owned history

| Bucket | Count | % of pool |
|---|---:|---:|
| **A — never seen in `scheduler_logs`** | **5,227** | 99.96% |
| **B — previously failed** (failure only) | 0 | 0% |
| **B — mixed** (≥1 failure and ≥1 success) | **2** | 0.04% |
| **C — successful but still eligible (anomaly)** | **0** | 0% |

Bucket C being empty confirms there is no leak: every account with a recorded
scheduler success has an L0 row and is correctly ineligible.

---

## 2. Failure history (eligible accounts only)

Joined **exclusively through `kol_account_id`**. Username matching was never used —
the architecture forbids it, and `scheduler_engine` documents why (two usernames
appear twice on the same platform, yielding 7,497 pairs from 7,494 accounts).

| Metric | Value |
|---|---:|
| Eligible accounts with ≥1 prior failure | **2** |
| Exactly 1 failure | 2 |
| Exactly 2 failures | 0 |
| Exactly 3 failures | 0 |
| 4+ failures | 0 |
| **Maximum failure count** | **1** |

### Failures by class

| Status | Count |
|---|---:|
| `private_unavailable` | **0** |
| `not_found` | **0** |
| `rate_limit` | **0** |
| `timeout` | **0** |
| `actor_error` | **0** |
| `unknown` | **0** |
| `failed` *(legacy, outside the 7-code taxonomy)* | **2** |

### Success and mixed history

Both failed accounts also have a success row. This is an **artifact, not a real
success**: on 2026-08-28 a single actor run produced both a `failed` profile row
and a `success` post row, the latter succeeding vacuously after filtering the
error item out (`"riekemeilanis23: 1 item error disaring"`). Neither produced an
L0 row, which is why both remain eligible.

| Username | Platform | Latest failure | Latest status |
|---|---|---|---|
| shabiraalulaadnan | tiktok | 2026-08-28 05:54:24 | `failed` |
| riekemeilanis23 | tiktok | 2026-08-28 06:00:53 | `failed` |

---

## 3. Top-25 batch impact

Ordering reproduced exactly: `followers_count DESC NULLS LAST, username ASC`.

| Batch size | Selected | Never attempted | Previously failed | 2+ failures | private_unavail | not_found | rate_limit | timeout | actor_error | unknown | legacy `failed` |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 | 25 | 23 | **2** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| 50 | 50 | 48 | **2** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| 100 | 100 | 98 | **2** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |

The previously-failed count does not grow with batch size, because only 2 such
accounts exist in the entire pool. Both sit at ranks 2 and 3.

### The actual top 25

| # | Username | Platform | Followers | Failures | Successes | Latest failure status | Latest failure at |
|---:|---|---|---:|---:|---:|---|---|
| 1 | bbrightvc | instagram | 18,018,065 | 0 | 0 | – | – |
| 2 | shabiraalulaadnan | tiktok | 10,664,778 | **1** | 1 | `failed` | 2026-08-28 05:54:24 |
| 3 | riekemeilanis23 | tiktok | 7,102,838 | **1** | 1 | `failed` | 2026-08-28 06:00:53 |
| 4 | mydeyaaa | tiktok | 6,700,000 | 0 | 0 | – | – |
| 5 | triarona | tiktok | 5,600,000 | 0 | 0 | – | – |
| 6 | cuterthandell | tiktok | 5,400,000 | 0 | 0 | – | – |
| 7 | kuliner1.menit | tiktok | 3,200,000 | 0 | 0 | – | – |
| 8 | jakarta_zone | instagram | 3,026,573 | 0 | 0 | – | – |
| 9 | bobonsantoso | tiktok | 2,600,000 | 0 | 0 | – | – |
| 10 | farhanzubedi | tiktok | 2,500,000 | 0 | 0 | – | – |
| 11 | ishmaannisa96 | tiktok | 2,300,000 | 0 | 0 | – | – |
| 12 | rinanose_josscy | tiktok | 2,300,000 | 0 | 0 | – | – |
| 13 | ns.putubahagiana | tiktok | 1,575,418 | 0 | 0 | – | – |
| 14 | jkt48gracia | instagram | 1,468,115 | 0 | 0 | – | – |
| 15 | javierstoy2.0 | tiktok | 1,400,000 | 0 | 0 | – | – |
| 16 | itsjesselin | tiktok | 1,300,000 | 0 | 0 | – | – |
| 17 | nadialaydrus | tiktok | 1,300,000 | 0 | 0 | – | – |
| 18 | zaramatoshi | tiktok | 1,300,000 | 0 | 0 | – | – |
| 19 | keanuagl | tiktok | 1,200,000 | 0 | 0 | – | – |
| 20 | loli_adelardo | tiktok | 1,200,000 | 0 | 0 | – | – |
| 21 | kocak.petcaah | instagram | 1,124,014 | 0 | 0 | – | – |
| 22 | nandapriscillia29 | tiktok | 1,100,000 | 0 | 0 | – | – |
| 23 | tissabianiazzahra | tiktok | 975,500 | 0 | 0 | – | – |
| 24 | be__ce | tiktok | 963,200 | 0 | 0 | – | – |
| 25 | stevanpasaribu | tiktok | 917,400 | 0 | 0 | – | – |

**Critical caveat on this table.** `bbrightvc`, `mydeyaaa` and the other rows
showing 0 failures **are not known-good**. They show 0 because:

- `bbrightvc` failed in the Phase 5F.2 pilot on 2026-09-13, but that failure was
  **lost** — logging was deferred to the end of the batch, the process was
  stopped, and `scheduler_logs` never received the row. The logging defect was
  fixed afterwards in Phase 5F.4.
- `bbrightvc` also carries `kol_directory.scrape_status = 'failed'` since
  2026-08-14, but that field is owned by the old pipeline and is excluded from
  this report by design.
- `mydeyaaa` was interrupted mid-actor-call and correctly produced no result.

So the true failure count among these 25 is **at least 4**, not 2. The table
reflects what the scheduler-owned store can prove, which is the point of the
report.

---

## 4. Platform breakdown (eligible, previously failed)

| Platform | Failed accounts | 1 failure | 2 failures | 3+ failures |
|---|---:|---:|---:|---:|
| Instagram | **0** | 0 | 0 | 0 |
| TikTok | **2** | 2 | 0 | 0 |

No Instagram failure is recorded in scheduler-owned history at all, despite the
5F.2 pilot failing on `bbrightvc`. This is the logging-loss gap, not evidence
that Instagram does not fail.

---

## 5. Failure age (descriptive only)

| Age of latest failure | Accounts |
|---|---:|
| < 1 day | 0 |
| 1–3 days | 0 |
| 4–7 days | 0 |
| 8–14 days | 0 |
| **15–30 days** | **2** |
| > 30 days | 0 |

These buckets are descriptive. They are **not** a cooldown proposal and must not
be read as one.

---

## 6. Data quality / linkage

| Metric | Value |
|---|---:|
| `scheduler_logs` total rows | **39** |
| Rows with `kol_account_id` | 35 |
| Rows without `kol_account_id` | 4 |

### By `job_name`

| `job_name` | Rows | With FK | Without FK | Scheduler-owned? |
|---|---:|---:|---:|---|
| `post_scrape` | 28 | 26 | 2 | No — `post_pipeline` |
| **`scheduled_scrape`** | **8** | **8** | **0** | **Yes** |
| `followers_scrape` | 2 | 0 | 2 | No |
| `profile_scrape` | 1 | 1 | 0 | No |

**Scheduler-owned rows have complete FK linkage: 8/8.** The 4 unlinked rows all
belong to other writers and were excluded from §2–§5 — not silently discarded,
but reported here and listed below.

### Scheduler-owned rows (`scheduled_scrape`) — the entire evidence base

| Status | Rows | First | Last |
|---|---:|---|---|
| `success` | 6 | 2026-08-27 07:30:56 | 2026-08-28 06:51:04 |
| `failed` | 2 | 2026-08-28 05:54:24 | 2026-08-28 06:00:53 |

### Non-scheduler rows, reported for completeness

| `job_name` | Status | Rows |
|---|---|---:|
| `post_scrape` | `success` | 27 |
| `post_scrape` | `private_unavailable` | 1 |
| `followers_scrape` | `success` | 2 |
| `profile_scrape` | `actor_error` | 1 |

The only two taxonomy codes ever observed in production —
`private_unavailable` and `actor_error` — come from **non-scheduler** jobs, one
occurrence each.

---

## 7. Decision-ready summary

### A. FACTS

- Eligible pool: **5,229** (2,350 Instagram, 2,879 TikTok).
- **5,227 of 5,229** eligible accounts have no scheduler-owned history at all.
- **2** eligible accounts have a scheduler-owned failure; both TikTok; both
  exactly 1 failure; both 15–30 days old; both carry legacy status `failed`.
- Maximum failure count anywhere in the eligible pool: **1**.
- Of the seven taxonomy codes, **zero** appear against any eligible account.
- Total scheduler-owned rows in existence: **8** (6 success, 2 failed).
- Scheduler-owned FK linkage: **8/8 complete**.
- Batch impact is flat at 2 previously-failed accounts for batch sizes 25, 50
  and 100.
- Bucket C (success yet still eligible) is empty — no eligibility leak.

### B. WHAT THE DATA SAYS

- The queue-blockage concern from Phase 5F.3 is **real but numerically tiny in
  the provable record**: 2 accounts, at ranks 2 and 3, would be re-attempted.
- Failure history is **not** dominated by `private_unavailable`, nor by
  `rate_limit`/`timeout` — it is dominated by a legacy `failed` string that
  predates the taxonomy and carries no permanent/transient signal.
- The taxonomy exists in code and in the schema, but has **essentially no
  production data behind it**. There is nothing to classify a policy against.
- The evidence base is 8 rows, all from a two-day window in August 2026.

### C. WHAT THE DATA CANNOT PROVE

- **Whether any failure is permanent or transient.** No `private_unavailable`,
  `not_found`, `rate_limit`, or `timeout` has ever been recorded against an
  eligible account.
- **The true failure rate.** The 5F.2 pilot's 3 failures were lost before the
  5F.4 logging fix, so at least 4 of the top 25 have failed in reality while the
  store shows 2.
- **Whether Instagram fails differently from TikTok.** Zero Instagram failures
  are recorded, yet the pilot's Instagram target demonstrably failed.
- **Whether the August TikTok failures are still true today.** The signature
  changed between then (1 error item) and the pilot (0 items), unexplained.
- **Any sensible cooldown interval.** Two data points 16 days apart cannot
  support one.

### D. PRODUCT DECISIONS REQUIRED

1. Is `private_unavailable` permanent, or may a private account become public?
2. Is `not_found` permanent, or could it be a rename?
3. For `rate_limit` / `timeout` — obviously transient — what deferral is
   acceptable?
4. After N failures, is a target retired? What is N?
5. Does a retired account stay visible in Discover? (Today failed accounts
   remain visible, labelled `Estimated`.)
6. Is retry automatic or manual? The only comparable product precedent —
   `discover_creators` — is **manual**: *"Refresh to try again."*

### E. TECHNICAL OPTIONS AFTER PRODUCT DECISION

Presented as options, not recommendations. None may be chosen without D.

1. **Derive deferral from `scheduler_logs` at query time.** No schema change.
   Last attempt, last failure, failure type and failure count are all derivable
   today. Only `next_eligible_at` is missing, and it is a function of the policy,
   not a column. Would likely want an index on `kol_account_id`, which has none.
2. **Add a scheduler-owned failure-state table or column.** More explicit and
   faster to query, but requires a migration and violates migration 028's stated
   constraint that `scheduler_logs` be the single scheduler activity store.
3. **Change the ordering instead of the eligibility.** E.g. push recently-failed
   targets to the back rather than excluding them. Still a business rule, but a
   softer one that never retires an account.
4. **Do nothing to eligibility; add operator visibility.** Surface failure counts
   so a human decides, matching the existing manual-refresh precedent.

---

## 8. Final recommendation

### **OPTION B — Evidence is insufficient; product policy must be defined before technical implementation.**

Option C was explicitly considered and rejected. A SQL filter excluding recently
failed accounts is trivially easy, and that is precisely the trap: with only 2
qualifying accounts and zero taxonomy coverage, such a filter would encode an
invented policy that the data cannot justify, while solving a problem affecting
0.04% of the pool.

Option A was rejected because 8 rows from a single two-day window — none of them
carrying a taxonomy code — cannot support a product rule about permanence.

**Next step should be: no implementation yet, and a product decision.**

The supporting technical step, if more evidence is wanted first, is a **small
instrumented production batch run *after* policy approval** — now genuinely
worth doing because Phase 5F.4 made per-target logging durable. A batch run
today would, for the first time, produce a real taxonomy distribution instead of
a legacy `failed` string. That run costs Apify credit and must not happen
without explicit approval.

---

## Methodology

### Eligibility predicate (verbatim from `select_profile_targets`)

```sql
FROM public.kol_directory      k
JOIN public.platforms          p ON p.id = k.platform_id
JOIN public.kol_social_account b ON b.kol_id = k.id
JOIN public.social_account     s ON s.id = b.social_account_id
                                AND s.platform_id = k.platform_id
WHERE p.key = :platform
  AND k.username IS NOT NULL
  AND btrim(k.username) <> ''
  AND lower(btrim(k.username)) <> ALL(ARRAY['aamandazahra'])
  AND NOT EXISTS (SELECT 1 FROM <l0 profile> pr WHERE pr.social_account_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM <l0 post>    po WHERE po.social_account_id = s.id)
```

### Scheduler-owned history join

```sql
sched AS (
  SELECT kol_account_id, status, started_at
    FROM public.scheduler_logs
   WHERE job_name = 'scheduled_scrape'      -- SCHEDULER_JOB_NAME
     AND kol_account_id IS NOT NULL
)
... LEFT JOIN sched g ON g.kol_account_id = e.kol_id
```

### Ordering (verbatim)

```sql
ORDER BY followers_count DESC NULLS LAST, username ASC
```

### Assumptions

1. **Scheduler-owned == `job_name = 'scheduled_scrape'`**, from
   `scrape_log.py:58` (`SCHEDULER_JOB_NAME`). Rows from `post_scrape`,
   `followers_scrape` and `profile_scrape` are other writers and are excluded
   from §2–§5, but fully reported in §6.
2. **"Previously failed" == ≥1 scheduler-owned row with `status <> 'success'`.**
   `kol_directory.scrape_status` is deliberately excluded — it is stale (frozen
   2026-08-14), foreign-owned, and provably out of sync with L0.
3. Joins use `kol_account_id` only; username matching is never used.
4. `l0_raw` tables are the authority for "already scraped".
5. Counts are a point-in-time snapshot of 2026-09-13.

### Row counts returned

| Query | Rows |
|---|---:|
| Eligible pool | 5,229 |
| Pool classification buckets | 2 |
| Failure distribution buckets | 2 |
| Failure classes | 1 |
| Platform breakdown | 2 |
| Failure-age buckets | 1 |
| Top-25 listing | 25 |
| `scheduler_logs` scanned | 39 |

### Verification of read-only execution

Every statement ran inside `BEGIN READ ONLY … ROLLBACK` with
`default_transaction_read_only = on` set at session level and `PGOPTIONS`
enforcing it at the server. No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CALL`,
or DDL was issued. No Apify actor was invoked. No source file was modified.
