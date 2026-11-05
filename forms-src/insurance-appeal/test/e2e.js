// Forms: the Insurance Appeal letter (Letters folder, #appeal).
// node e2e.js <url>   (serve the repo root, e.g. python3 -m http.server 8767,
//                      then http://127.0.0.1:8767/NLO_Financial_Suite.html)
const { chromium } = require('playwright');
const URL0 = process.argv[2];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const offsite = r => { const u = r.request().url(); return /^https?:\/\//.test(u) && !u.startsWith('http://127.0.0.1') ? r.abort() : r.continue(); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_BLOCKED|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
  await page.route('**/*', offsite);
  const chip = id => page.click('label.aging-chip:has(input#' + id + ')');
  const txt = sel => page.textContent(sel).then(t => t.replace(/\s+/g, ' ').trim());
  const iso = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const today = () => { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };

  // ---- deep link, folder, Batch Print column
  await page.goto(URL0 + '#appeal');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.getElementById('tab-appeal').classList.contains('active')), '#appeal opens the form');
  ok(await page.evaluate(() => document.getElementById('folderBtn-letters').classList.contains('active')), '... in the Letters folder');
  ok(await page.evaluate(() => document.querySelector('#folderTabs-letters .tab-btn[data-tab="appeal"]').classList.contains('active')), '... with its tab lit');
  ok(await page.evaluate(() => !!document.getElementById('batch_cb_appeal') && document.getElementById('batch_cb_appeal').closest('#batchList-letters') !== null), 'Batch Print lists it under Letters');
  ok(await page.evaluate(() => BATCH_FORMS.some(f => f.key === 'appeal' && f.nameId === 'ins_patientName')), 'registered in BATCH_FORMS');
  ok((await page.inputValue('#ins_formDate')) === today(), 'letter date defaults to today');
  ok((await page.inputValue('#ins_contact')) === 'Financial Coordinator', 'office contact defaults to the Financial Coordinator');
  ok((await page.$eval('#ins_amount', el => getComputedStyle(el).paddingLeft)) === '24px', 'money fields leave room for the $ (was 12px on every form)');

  // ---- deadline: counted from the denial date by plan type; a typed deadline wins; past = warning
  await page.fill('#ins_denialDate', '2026-10-20');
  ok((await page.inputValue('#ins_deadline')) === '2027-04-18', 'ERISA: 180 days from the denial');
  await page.selectOption('#ins_planType', 'medicaid');
  ok((await page.inputValue('#ins_deadline')) === '2026-12-19', 'Medicaid managed care: 60 days');
  await chip('ins_level_ext');
  ok((await page.inputValue('#ins_deadline')) === '2027-02-17', 'external review / fair hearing: 120 days');
  await chip('ins_level_1'); await page.selectOption('#ins_planType', 'erisa');
  await page.fill('#ins_deadline', '2027-01-15');
  await page.fill('#ins_claimNo', 'X1');
  ok((await page.inputValue('#ins_deadline')) === '2027-01-15', 'a deadline typed by staff is kept');
  await page.fill('#ins_deadline', ''); await page.fill('#ins_claimNo', 'X2');
  ok((await page.inputValue('#ins_deadline')) === '2027-04-18', 'cleared, it refills from the denial date');
  ok((await page.$eval('#ins_deadlineNote', el => el.className)).includes('ok') && /April 18, 2027/.test(await txt('#ins_deadlineNote')), 'note names the deadline');
  await page.fill('#ins_denialDate', '2025-01-10');
  ok((await page.$eval('#ins_deadlineNote', el => el.className)).includes('bad') && /passed/.test(await txt('#ins_deadlineNote')), 'a passed deadline is flagged');
  await page.fill('#ins_denialDate', '2026-10-20');

  // ---- HLD scoring per the Florida sheet; the score is cited only when it helps
  await page.fill('#ins_overjet', '8'); await page.fill('#ins_overbite', '6'); await page.fill('#ins_crowdU', '5'); await page.fill('#ins_crowdL', '4');
  await page.fill('#ins_ectopicN', '1'); await chip('ins_xb_uni');
  ok((await txt('#ins_hldCalc')) === '31', 'HLD: 8 + 6 + 5 + 5 + 3 + 4 = 31');
  ok(/qualifies/.test(await txt('#ins_hldVerdict')), '... qualifies at 26+');
  await page.fill('#ins_crowdU', '3'); await page.fill('#ins_crowdL', '3');
  ok((await txt('#ins_hldCalc')) === '21' && /below 26/.test(await txt('#ins_hldVerdict')), 'crowding of 3.5 mm or less does not score; 21 is below 26');
  await page.fill('#ins_hldOverride', '27');
  ok(/27/.test(await txt('#ins_hldVerdict')) && /override/.test(await txt('#ins_hldLabel')), 'the doctor’s own score overrides');
  await page.fill('#ins_hldOverride', '');
  await chip('ins_aq_impinge');
  ok((await txt('#ins_hldVerdict')) === 'Qualifies', 'an auto-qualifying condition qualifies regardless of score');
  await chip('ins_aq_impinge');

  // ---- the response follows the reason and the fields until staff edit it
  await page.fill('#ins_patientName', 'Olivia Test');
  await page.fill('#ins_reasonQuote', 'Orthodontic treatment is cosmetic');
  let reb = await page.inputValue('#ins_rebuttal');
  ok(/characterizes this treatment as “Orthodontic treatment is cosmetic”/.test(reb) && /Olivia Test has a diagnosed malocclusion/.test(reb) && /overjet of 8 mm/.test(reb), 'necessity response quotes the EOB and the measurements: ' + reb.slice(0, 80));
  ok(!/HLD/.test(reb), 'a score below 26 is not volunteered in the letter');
  await page.fill('#ins_crowdU', '5'); await page.fill('#ins_crowdL', '4');
  reb = await page.inputValue('#ins_rebuttal');
  ok(/score 31, above the 26-point threshold/.test(reb), 'a qualifying score is cited');
  await page.selectOption('#ins_reason', 'age');
  ok(await page.evaluate(() => !document.getElementById('ins_extraRow').hidden && getComputedStyle(document.getElementById('ins_ageLimitWrap')).visibility === 'visible'), 'age limit field appears for an age denial');
  await page.fill('#ins_dob', '2012-03-14'); await page.fill('#ins_startDate', '2025-11-03'); await page.fill('#ins_ageLimit', '19');
  reb = await page.inputValue('#ins_rebuttal');
  ok(/began on November 3, 2025, when the patient was 13 years old — within the plan’s limit of 19/.test(reb), 'age response computes the age at banding: ' + reb.slice(60, 160));
  ok(/under the plan’s limit of 19/.test(await txt('#ins_treatNote')), 'screen note agrees');
  await page.selectOption('#ins_reason', 'wip');
  await page.fill('#ins_months', '24'); await page.fill('#ins_effDate', '2026-01-01'); await page.fill('#ins_fee', '6400');
  reb = await page.inputValue('#ins_rebuttal');
  ok(/24 months in total, of which 23 months of active treatment remain after the effective date/.test(reb) && /\$266\.67 per month/.test(reb), 'treatment-in-progress response does the proration: ' + reb.slice(300, 460));
  await page.selectOption('#ins_reason', 'timely');
  await page.fill('#ins_dos', '2026-09-08'); await page.fill('#ins_submitDate', '2026-09-15');
  reb = await page.inputValue('#ins_rebuttal');
  ok(/first submitted on September 15, 2026 through our electronic clearinghouse \(DentalXchange\), 7 days after the date of service/.test(reb), 'timely-filing response counts the days');
  await page.selectOption('#ins_reason', 'necessity');
  await page.fill('#ins_rebuttal', 'My own words.');
  await page.fill('#ins_reasonQuote', 'Changed wording');
  ok((await page.inputValue('#ins_rebuttal')) === 'My own words.' && /Edited by hand/.test(await txt('#ins_rebuttalState')), 'a hand-edited response is left alone');
  await page.click('#tab-appeal .ins-link');
  ok(/Changed wording/.test(await page.inputValue('#ins_rebuttal')) && /Follows the fields/.test(await txt('#ins_rebuttalState')), 'Reset wording rewrites it from the fields');
  const req = await page.inputValue('#ins_request');
  ok(/Reverse the denial and pay benefits for D8080/.test(req), 'request #1 follows the claim: ' + req.slice(0, 60));
  await chip('ins_kind_pre');
  ok(/approve the pre-treatment estimate/.test(await page.inputValue('#ins_request')), '... and the kind of denial');
  await chip('ins_kind_post');

  // ---- print: the copies prompt, one copy, two copies (second one unlabeled)
  await page.evaluate(() => {
    window.__prints = [];
    const shown = d => { const l = d.querySelector('.copy-label'); return l && getComputedStyle(l).visibility !== 'hidden' ? l.textContent : null; };
    window.print = () => window.__prints.push(Array.from(document.querySelectorAll('.print-doc.print-active')).map(d => ({ id: d.id, label: shown(d) })));
  });
  await page.selectOption('#ins_carrier', 'Delta Dental'); await page.fill('#ins_memberId', 'XQW884312'); await page.fill('#ins_subscriber', 'Carla Test');
  await page.fill('#ins_fax', '8005551234'); await page.fill('#ins_amount', '2000');
  await chip('ins_fx_trauma'); await chip('ins_icd_212'); await chip('ins_icd_23');
  await page.click('#ins_printBtn');
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => document.getElementById('copiesDlg').open), 'Print asks about copies');
  ok((await txt('#copiesWhat')) === 'Appeal of Adverse Benefit Determination', 'the prompt names the letter');
  ok(/an unlabeled copy/.test(await txt('#copiesTwoSub')), 'the second copy is unlabeled (it goes to the plan)');
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  let prints = await page.evaluate(() => window.__prints);
  ok(prints.length === 1 && prints[0].length === 1 && prints[0][0].id === 'appeal_printDoc' && prints[0][0].label === null, 'one copy, no label: ' + JSON.stringify(prints));
  await page.evaluate(() => { window.__prints = []; });
  await page.click('#ins_printBtn'); await page.waitForTimeout(100); await page.keyboard.press('2'); await page.waitForTimeout(300);
  prints = await page.evaluate(() => window.__prints);
  ok(prints.length === 1 && prints[0].length === 2 && prints[0][0].label === 'Next Level Copy' && prints[0][1].label === null, 'two copies: Next Level Copy + unlabeled: ' + JSON.stringify(prints));
  ok(await page.evaluate(() => document.querySelectorAll('.print-doc.print-active, [id$="_copy2"], .copy-label').length === 0), 'print state torn down');

  // ---- what the letter says (populate without printing, as Batch Print does)
  const fillDoc = () => page.evaluate(() => { window._batchCollect = []; ins_print(); const ids = window._batchCollect.slice(); window._batchCollect = null; return ids; });
  ok((await fillDoc())[0] === 'appeal_printDoc', 'the print call collects the doc in batch mode');
  ok(/^RE: FIRST-LEVEL APPEAL — Claim for D8080 \(comprehensive orthodontic treatment of the adolescent dentition\) — Olivia Test$/.test(await txt('#ins_p_re')), 'RE line: ' + await txt('#ins_p_re'));
  ok((await txt('#ins_p_carrier')) === 'Delta Dental' && (await txt('#ins_p_fax')) === 'Via fax: (800) 555-1234', 'addressed to the plan, fax formatted');
  ok((await txt('#ins_p_subscriber')) === 'Carla Test (patient is the child)' && (await txt('#ins_p_memberId')) === 'XQW884312' && (await txt('#ins_p_dob')) === '03/14/2012', 'facts block');
  ok((await txt('#ins_p_reasonQuote')) === '“Changed wording”' && (await txt('#ins_p_icd')) === 'M26.212, M26.23' && (await txt('#ins_p_amount')) === '$2,000.00', 'denial wording, diagnosis codes, amount');
  ok(/as the authorized representative of Carla Test \(signed designation enclosed\), I am filing this first-level appeal of the adverse benefit determination dated October 20, 2026, which denied payment for D8080/.test(await txt('#ins_p_intro')), 'intro: ' + (await txt('#ins_p_intro')).slice(0, 120));
  const rebParas = (await page.inputValue('#ins_rebuttal')).split(/\n\s*\n/).filter(s => s.trim()).length;
  ok(await page.evaluate(() => document.querySelectorAll('#ins_p_rebuttal p').length) === rebParas && rebParas >= 2, 'response prints one paragraph per blank-line break (' + rebParas + ')');
  const clin = await txt('#ins_p_clinical');
  ok(/Olivia Test presents with a malocclusion \(ICD-10-CM M26\.212, M26\.23\) characterized by an overjet of 8 mm/.test(clin), 'clinical summary states the findings');
  ok(/leaves the maxillary incisors protruding and exposed to injury\. An overjet above 3 mm roughly doubles the odds of traumatic injury/.test(clin), '... the functional impact with the literature');
  ok(/score 31 on the Handicapping Labio-lingual Deviation/.test(clin) && /over approximately 24 months, beginning November 3, 2025 with completion expected November 3, 2027/.test(clin) && /The total fee is \$6,400\.00/.test(clin), '... the index score and the plan');
  const enclN = await page.evaluate(() => document.querySelectorAll('#ins_enclGroup input:checked').length);
  ok(await page.evaluate(() => document.querySelectorAll('#ins_p_encl li').length) === enclN && enclN === 7, 'enclosures: one line per checked item (' + enclN + ')');
  ok(await page.evaluate(() => document.querySelectorAll('#ins_p_requests li').length) === 4, 'four requests with the peer-to-peer call');
  ok(/who should be a licensed orthodontist/.test(await txt('#ins_p_requests')) && /Identification of the reviewer/.test(await txt('#ins_p_requests')) && /within 60 days/.test(await txt('#ins_p_requests')), '... reviewer, criteria, decision clock');
  ok(/29 C\.F\.R\. § 2560\.503-1/.test(await txt('#ins_p_rights')) && /A decision is due within 60 days/.test(await txt('#ins_p_rights')), 'ERISA rights paragraph');
  ok(/Financial Coordinator at \(352\) 332-7466/.test(await txt('#ins_p_close')), 'closing names the office contact');
  ok((await txt('#ins_p_cc')) === 'cc: Olivia Test · Enclosures: 7' || /Enclosures: 7/.test(await txt('#ins_p_cc')), 'cc line counts the enclosures: ' + await txt('#ins_p_cc'));
  ok((await txt('#ins_p_license')) === '________' && (await txt('#ins_p_npi')) === '________', 'blank license / NPI print as lines to fill in');
  ok(await page.$eval('#ins_pg_auth', el => el.style.display !== 'none') && (await txt('#ins_pa_memberId')) === 'XQW884312', 'Designation page prints when the office files');
  ok(await page.$eval('#ins_pg_impact', el => el.style.display === 'none'), 'Statement page off by default');
  ok(await page.$eval('#ins_pg_track', el => el.style.display !== 'none') && (await txt('#ins_pt_deadline')) === '04/18/2027' && (await txt('#ins_pt_due')) === '60 days after receipt', 'Tracking sheet with the deadline and the decision clock');
  await page.uncheck('#ins_incP2P'); await page.check('#ins_incImpact'); await page.check('#ins_expedite'); await fillDoc();
  ok(await page.evaluate(() => document.querySelectorAll('#ins_p_requests li').length) === 3, 'no peer-to-peer request when unticked');
  ok(/Expedited review requested/.test(await txt('#ins_p_urgent')) && /within 72 hours/.test(await txt('#ins_p_requests')), 'expedited: banner and 72-hour clock');
  ok(await page.$eval('#ins_pg_impact', el => el.style.display !== 'none') && (await txt('#ins_pi_patient')) === 'Olivia Test', 'Statement page prints when ticked');
  await page.uncheck('#ins_expedite'); await page.check('#ins_incP2P');
  for (const [pt, re] of [['medicaid', /42 C\.F\.R\. § 438\.402/], ['medical', /45 C\.F\.R\. § 147\.136/], ['fl', /Florida Department of Financial Services/], ['unknown', /generally 60 days/]]) {
    await page.selectOption('#ins_planType', pt); await fillDoc();
    ok(re.test(await txt('#ins_p_rights')), 'rights paragraph for plan type ' + pt);
  }
  await page.selectOption('#ins_planType', 'medicaid'); await fillDoc();
  ok(/State Fair Hearing/.test(await txt('#ins_p_requests')) && /State Fair Hearing within 120 days/.test(await txt('#ins_pt_next')), 'Medicaid: fair hearing in the requests and on the tracking sheet');
  await page.selectOption('#ins_planType', 'erisa');
  await chip('ins_filer_member'); await page.fill('#ins_rp', 'Carla Test'); await fillDoc();
  ok(/I write in support of the first-level appeal filed by Carla Test, the patient’s parent/.test(await txt('#ins_p_intro')), 'when the family files, the letter supports their appeal');
  ok(await page.$eval('#ins_pg_auth', el => el.style.display === 'none') && await page.$eval('#ins_incAuth', el => el.closest('label').style.display === 'none'), '... and the Designation page is off');
  await chip('ins_filer_office');

  // ---- Batch Print fills the name and includes the appeal
  await page.evaluate(() => { window.__prints = []; });
  await page.click('#folderBtn-batch');
  await page.fill('#batch_patientName', 'Batch Pat');
  await page.check('#batch_cb_appeal'); await page.check('#batch_cb_mil');
  await page.click('#batchPrintBtn'); await page.waitForTimeout(100); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  prints = await page.evaluate(() => window.__prints);
  ok(prints.length === 1 && prints[0].map(d => d.id).join(',') === 'mil_printDoc,appeal_printDoc', 'batch prints both letters in page order: ' + JSON.stringify(prints));
  ok((await txt('#ins_p_patient')) === 'Batch Pat', 'batch filled the patient name');
  await page.uncheck('#batch_cb_appeal'); await page.uncheck('#batch_cb_mil');
  await page.click('#folderBtn-letters'); await page.click('.tab-btn[data-tab="appeal"]');

  // ---- Clear
  await page.click('#tab-appeal .btn-clear');
  ok((await page.inputValue('#ins_patientName')) === '' && (await page.inputValue('#ins_memberId')) === '' && (await page.inputValue('#ins_overjet')) === '' && (await page.inputValue('#ins_denialDate')) === '' && (await page.inputValue('#ins_deadline')) === '', 'Clear empties the fields');
  ok((await page.inputValue('#ins_reason')) === 'necessity' && (await page.inputValue('#ins_planType')) === 'erisa' && await page.isChecked('#ins_cdt_8080') && await page.isChecked('#ins_en_denial') && !await page.isChecked('#ins_fx_trauma') && await page.isChecked('#ins_incTrack') && !await page.isChecked('#ins_incImpact'), '... and restores the defaults');
  ok((await page.inputValue('#ins_formDate')) === today() && (await page.inputValue('#ins_contact')) === 'Financial Coordinator', '... date and contact');
  ok((await txt('#ins_p_patient')) === '' && (await txt('#ins_pa_memberId')) === '' && (await txt('#ins_pt_patient')) === '', '... and wipes the last print');
  ok(/Follows the fields/.test(await txt('#ins_rebuttalState')) && /characterizes this treatment as the reason stated on the explanation of benefits/.test(await page.inputValue('#ins_rebuttal')), '... response rewritten for an empty form');

  // ---- the Military Letter still prints as before (same folder)
  await page.evaluate(() => { window.__prints = []; });
  await page.click('.tab-btn[data-tab="mil"]'); await page.fill('#mil_patientName', 'Mil Pat'); await page.fill('#mil_endDate', '2026-01-05');
  await page.click('#mil_printBtn'); await page.waitForTimeout(100); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  prints = await page.evaluate(() => window.__prints);
  ok(prints.length === 1 && prints[0].length === 1 && prints[0][0].id === 'mil_printDoc', 'Military Letter unaffected');

  // ---- screens: no sideways scroll at tablet widths
  for (const w of [1024, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.click('.tab-btn[data-tab="appeal"]'); await page.waitForTimeout(100);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'no horizontal scroll at ' + w + 'px');
  }

  ok(errors.length === 0, 'no page errors: ' + JSON.stringify(errors));
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
