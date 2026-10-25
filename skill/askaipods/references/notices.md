# askaipods — notices, empty results, and secondary fields

Read this file when a response has empty `results`, a non-null `meta.warning`, `meta.window.expanded === true`, or `meta.quota.refunded === true`. The common path (results present, none of those set) needs only SKILL.md.

Banners go with the banners in SKILL.md, as italic lines before the first section heading. An empty-result message takes the place of the result sections; the refund note goes at the end. Never invent quotes to fill an empty result, and never silently swallow a notice.

## Freshness banner (results present, `meta.warning` non-null)

Mandatory: an unannotated partial result misrepresents the corpus state as authoritative.

- `meta.warning.code === "corpus_stale_for_requested_window"` → `*Note: The indexed corpus has no episodes in the requested window (newest indexed episode: <meta.corpus_freshness.newest_date>) — results below may come from an expanded window. A longer --days (up to your tier cap) widens coverage.*`
- `meta.warning.code === "index_metadata_stale"` → `*Note: Recently indexed episodes are still propagating to the search index — some relevant matches may be missing. Retry in a few minutes for complete coverage.*`
- any other code → `*Note: Server flagged a freshness concern with this search (code: <meta.warning.code>) — results may be incomplete.*`

## Window expansion note (results present, `meta.window.expanded === true`)

When the requested window holds fewer than 20 matches, the server retries wider windows from `[30, 60, 90]` days (only windows longer than the requested one and within the tier cap). Results inside the requested window are kept, so never say the window was empty.

- `window.truncated` not `true` → `*Note: Fewer than 20 matches in the requested <requested_days>-day window, so the search widened to the last <served_days> days — results may include episodes older than <requested_days> days.*`
- `window.truncated === true` and `served_days > requested_days` → `*Note: The search widened to the last <served_days> days before a transient error interrupted it — results may be incomplete and may include episodes older than <requested_days> days. Retry in a moment.*`
- `window.truncated === true` otherwise → `*Note: Widening the search beyond the requested <requested_days>-day window was interrupted by a transient error — results may be incomplete. Retry in a moment.*`

Freshness banners come first when both apply. When you filtered the results to a calendar period, say instead how many returned results fall inside the period.

## Empty results — priority ladder

`meta.warning` and `meta.window` are nullable; an absent field falls through to the next step. Use the first step that matches and do not stack messages:

1. `meta.warning?.code === "corpus_stale_for_requested_window"` → "No episodes indexed in the requested window (newest indexed episode: `<meta.corpus_freshness.newest_date>`). Try a longer `--days` value (up to your tier cap of 30 anonymous / 90 free / 365 member; omitting `--days` already searches that cap)." When `meta.window.served_days` already equals `meta.restrictions.max_days`, leave out the longer-`--days` suggestion. Do NOT suggest rephrasing — the cause is freshness, not semantics.
2. `meta.warning?.code === "index_metadata_stale"` → "Recently indexed episodes are still propagating to the search index — retry in a few minutes."
3. `meta.warning?.code` is any other value → "No results. The server flagged a freshness issue with this search (code: `<meta.warning.code>`) — results may be incomplete or the requested window may be stale. Try a longer `--days` (up to your tier cap) or retry in a few minutes."
4. `meta.window?.truncated === true` → the widening was interrupted by a transient error; tell the user to retry in a moment (not to rephrase).
5. `meta.window?.expanded === true` → "No quotes found. The API expanded the search from N to M days but found no matches. Try rephrasing or broadening the query." Append "(corpus indexed through `<newest_date>`)" when `meta.corpus_freshness?.newest_date` is present.
6. Otherwise → "No quotes found for that topic. The corpus covers AI/ML, venture capital, global markets & finance, semiconductors & compute, and tech policy & geopolitics — for a topic outside these, a web search may serve better; otherwise try rephrasing or broadening the query."

The closing tier note from SKILL.md still applies after an empty result.

## Refund note

If `meta.quota.refunded === true`, end with: "_This search was refunded — it did not count against your daily quota._" The server refunds only when a freshness warning fired AND zero results were delivered, at most 5 times per user (or IP) per UTC day — check `refunded === true`, not the warning.

## Secondary fields

- **`meta.quota`** — `used` and `limit` are always present; `period` is typically `"daily"`; `next_reset` is ISO-8601; `refunded` is optional (above).
- **`meta.restrictions`** — the tier's caps, e.g. `{ max_days: 365 }` for member, or `{ max_results: 20, max_days: 30, order: "published_at_desc", ... }` for anonymous (`max_days: 90` for free). Take the closing-note cap from `max_days`; never branch the tier on this field.
- **`meta.window`** — `{ requested_days, served_days, expanded, attempted_days?, reason_code?, truncated? }`, or `null`. `requested_days` is the window applied (the `--days` value capped at the tier max, or the tier max); `served_days` is the last window whose query completed; `reason_code` (`expanded_topk_filled` / `expanded_partial_fill` / `exhausted_windows_empty`) is diagnostic.
- **`meta.corpus_freshness`** — `{ newest_date: "YYYY-MM-DD" | null }`, the newest indexed episode; render `null` as "date unknown".
- **`meta.cta`** — `null`, or a non-member call to action: anonymous `{ follow: "<url>" }` (safe to ignore), free `{ waitlist: "<url>" }` (used in the free closing note).
- **`sort`** — `null` on a server that predates the field; `render_hint` already accounts for it.
