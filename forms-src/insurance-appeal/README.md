# Forms: Insurance Appeal letter

**Where:** Forms (`NLO_Financial_Suite.html`) → **Letters** folder → **Insurance Appeal**. Deep link `NLO_Financial_Suite.html#appeal`.
Also in Batch Print under Letters.

**What it prints** (one job, Dr. Akhavan signs):
1. **The appeal letter** on letterhead — addressed to the plan's appeals department, a RE line, a facts box (patient,
   subscriber, member ID, group, claim #, date of service, procedure and diagnosis codes, denial date, amount, the plan's
   stated reason quoted), then: a point-by-point **Response to the Stated Reason** (one template per reason, editable),
   a **Clinical Summary and Medical Necessity** section built from the measurements entered (only what is entered prints),
   a numbered **Documentation Enclosed** list, a **Requested Action** list (the specific ask, a peer-to-peer call with a
   licensed-orthodontist reviewer, the reviewer's identity and the criteria relied upon, a decision on the clock) and a
   rights paragraph worded for the plan type.
2. **Designation of Authorized Representative** (on by default when our office files) — the member/parent signs it so the
   plan has to accept an appeal from an out-of-network office. Doubles as a records release and assignment of benefits.
3. **Patient / Parent Statement** (off by default) — prompts and lines for the family to write in by hand.
4. **Appeal Tracking Sheet** (on by default; office use, never sent) — pre-send checklist, how it was sent, decision due
   date, follow-up calls at 7 and 21 days, outcome and the next step if upheld.

**Reasons with a written response:** not medically necessary / cosmetic · not a covered benefit · age limit · treatment in
progress before coverage (prorates months and fee) · waiting period (computes the end date, prior-coverage credit) ·
missing documentation · lifetime maximum / frequency (accounting of the max) · no pre-estimate / authorization · timely
filing (counts the days, cites the DentalXchange acceptance report) · coordination of benefits · out-of-network ·
duplicate claim · procedure code (age and dentition on the banding date) · other.

**Deadline and clock:** the appeal deadline fills from the denial date — 180 days (ERISA, Florida-regulated, medical,
unknown), 60 days (Medicaid managed care), 120 days (external review / fair hearing); a typed deadline is kept. The
decision clock printed in the letter: 30 days pre-service, 60 post-service, 72 hours expedited, 30 calendar days Medicaid,
45 days external review (90 for a Medicaid fair hearing).

**HLD index:** scored from the measurements per the Florida Medicaid sheet (overjet ×1, overbite ×1, reverse overjet ×5,
open bite ×4, ectopic teeth ×3, crowding > 3.5 mm ×5 per arch, labio-lingual spread ×1, unilateral posterior crossbite 4;
26 or more qualifies; seven auto-qualifying conditions qualify alone). The score is cited in the letter **only when it is
26 or more**; a lower score is shown on screen and left out of the letter. "HLD as scored by Dr." overrides the computed figure.

**Rights wording:** 29 CFR 2560.503-1 (ERISA group plans: 180 days to appeal, no-deference review by someone not involved,
consultation with a professional trained in the field, identification of experts, free copies of the claim file and of any
internal guideline, 30/60-day decisions, 72 hours urgent); 42 CFR 438.402 / 438.406 / 438.408 (Medicaid managed care:
60-day appeal window, reviewer with clinical expertise, 30-day resolution, State Fair Hearing); 45 CFR 147.136 (medical
plans: external review); Florida Department of Financial Services consumer helpline 1-877-693-5236 for fully insured plans.
Overjet / trauma citation: Arraj, Rossi-Fedele & Doğramacı, *Dental Traumatology* 2019 (meta-analysis, 41 studies).
It is a template, not legal advice.

**Office constants** (top of the `INSURANCE APPEAL LETTER` script section): `INS_LICENSE` (falls back to the Military
Letter's `MIL_LICENSE`), `INS_NPI`, `INS_CONTACT` ("Financial Coordinator"). Blank license / NPI print as lines to fill in.
Fax (352) 332-4322 and Questions@thenextlevelorthodontics.com print in the signature block.

**Also changed:** every money field in Forms now leaves room for its `$` prefix (`.money-wrap input { padding-left: 24px !important }`);
before, the generic input rule won and the `$` sat on the first digit.

## Test
Serve the repo root (`python3 -m http.server 8767`), then
`node test/e2e.js http://127.0.0.1:8767/NLO_Financial_Suite.html` — deep link and Batch Print registration, deadline math
by plan type, HLD scoring (threshold, override, auto-qualifier, not cited below 26), the response following the reason and
the fields until edited (Reset wording), the copies prompt (one copy unlabeled; two = Next Level Copy + unlabeled), what
the letter says (RE line, facts, intro, paragraphs, clinical summary, enclosures, requests with and without peer-to-peer,
expedited banner, rights per plan type, Medicaid fair hearing, member-filed variant), the optional pages, Batch Print,
Clear, the Military Letter unaffected, no sideways scroll at 1024 / 768 px, no page errors.
