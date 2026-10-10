// Pure-function checks on the bundle: dates, units, dilution math, conversions.
const fs=require('fs');
const src=fs.readFileSync(''+require('path').join(__dirname,'..','dist','app.bundle.js')+'','utf8');
const stub=`var document={readyState:'loading',addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};var window={self:1,top:1,print(){},addEventListener(){}};var location={hash:''};var localStorage={getItem(){return null},setItem(){}};var navigator={};var CSS={escape:s=>s};`;
const vm=require('vm'); const ctx={console}; vm.createContext(ctx); vm.runInContext(stub+src,ctx);
const r=(c)=>vm.runInContext(c,ctx);
let fails=0; const eq=(a,b,m)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok){fails++;console.log('FAIL',m,'got',a,'want',b)}};
eq(r("fmtDateLong('2001-04-12','es')"),'12 abr 2001','es date');
eq(r("fmtDateLong('2026-10-23','en',true)"),'Fri, Oct 23, 2026','en long');
eq(r("fmtDateLong('2026-10-23','es',true)"),'vie, 23 oct 2026','es long');
eq(r("addDays('2026-10-09',14)"),'2026-10-23','add days');
eq(r("fmtDateTime('2026-10-09T09:10')"),'10/09/2026 9:10 AM','datetime');
eq(r("fmtDateTime('2026-10-09T12:00')"),'10/09/2026 12:00 PM','noon');
eq(r("fmtDateTime('2026-10-09T00:05')"),'10/09/2026 12:05 AM','midnight');
eq(r("addHours('2026-10-09T09:10',24)"),'2026-10-10T09:10','use by');
// defaults: Xeomin 100 U + 2.5 mL bacteriostatic (AAFE)
eq([r("S.product"),r("S.vial"),r("S.diluent"),r("S.diluentType")],['xeomin',100,2.5,'bact'],'xeomin default');
eq(r("useByHrs()"),672,'AAFE 4 weeks'); r("S.diluentType='pf'"); eq(r("useByHrs()"),24,'label 24 h'); r("S.diluentType='bact'");
// dilution: 100 U in 2.5 mL = 4 U/0.1 mL, 0.4 U per mark
r("S.vial=100;S.diluent=2.5;S.product='botox'");
eq(r("per01()"),4,'per0.1'); eq(+r("perMark()").toFixed(4),0.4,'per mark');
eq(r("fmtMl(8/conc())"),'0.20','8U vol'); eq(r("fmtMl(1.5/conc())"),'0.0375','1.5U vol');
// defaults
eq(r("JSON.stringify(defaultsFor('glabella'))"),JSON.stringify({'proc|M':4,'cmed|R':4,'cmed|L':4,'clat|R':4,'clat|L':4}),'glabella defaults');
r("S.items=[];addItem('glabella');addItem('forehead');addItem('crows')");
const t=JSON.parse(r("JSON.stringify(totals())"));
eq([t.T,t.R,t.L,t.M,t.sites],[42,18,18,6,16],'upper-face totals, AAFE starting doses');
r("S.items=[];addItem('mass-brux')"); eq([r("totals().T"),r("totals().sites")],[20,2],'masseter brux AAFE 10 U/side, one site');
r("S.items=[];addItem('temporalis')"); eq([r("totals().T"),r("totals().sites")],[20,4],'temporalis AAFE 10 U/side');
r("S.items=[];addItem('perioral')"); eq([r("totals().T"),r("totals().sites")],[3.5,7],'lip lines 7 sites, 3.5 U');
r("S.items=[];addItem('mass-hyp')"); eq(r("totals().T"),50,'masseter contour 25/side');
r("S.items=[];addItem('gs-asym')"); eq(r("JSON.stringify(findItem('gs-asym').d)"),JSON.stringify({'yonsei|R':2,'yonsei|L':1,'nlf|R':0,'nlf|L':0,'lat|R':0,'lat|L':0}),'asym defaults');
// product conversion Botox -> Dysport -> Botox
r("S.items=[];addItem('mass-brux');changeProduct('dysport')");
eq(r("findItem('mass-brux').d['ctr|R']"),25,'dysport conversion 10->25');
eq(r("S.vial"),300,'dysport vial'); eq(r("S.diluent"),1.5,'dysport diluent');
eq(r("JSON.stringify(presetMl())"),'[1.5,2.5,3]','dysport 300 presets'); r("S.vial=500"); eq(r("JSON.stringify(presetMl())"),'[1,2,2.5]','dysport 500 presets, no 5 mL'); r("S.vial=300;S.diluent=1.5");
r("changeProduct('botox')"); eq(r("findItem('mass-brux').d['ctr|R']"),10,'back to botox');
r("changeProduct('xeomin')"); eq([r("findItem('mass-brux').d['ctr|R']"),r("S.conv")],[10,null],'botox->xeomin 1:1, no banner');
// steps / bounds
r("S.items=[];addItem('gs-ant');stepDose('gs-ant.yonsei|R',-1);stepDose('gs-ant.yonsei|R',-1);stepDose('gs-ant.yonsei|R',-1);stepDose('gs-ant.yonsei|R',-1);stepDose('gs-ant.yonsei|R',-1)");
eq(r("findItem('gs-ant').d['yonsei|R']"),0,'floor at 0');
r("for(var i=0;i<40;i++)stepDose('gs-ant.yonsei|L',1)"); eq(r("findItem('gs-ant').d['yonsei|L']"),10,'cap at 2x range max');
r("S.items=[];addItem('glabella');stepDose('glabella.proc|M',1)"); eq(r("findItem('glabella').d['proc|M']"),4.5,'midline step');
// note contents
r("S.items=[];addItem('glabella');S.checks.tolerated=false;S.notes=''");
const note=r("chartNote()");
eq(/Procerus: 4 \(midline\)/.test(note),true,'note midline'); eq(/Tolerated/.test(note),false,'no unconfirmed tolerated line');
eq(/Total 20 U \(R 8, L 8, midline 4\)/.test(note),true,'note total');
// record shows midline rows and skips optional 0 U sites
r("S.items=[];addItem('glabella');addItem('mass-brux')");
const rec=r("docRecord()");
eq(/Procerus/.test(rec),true,'record has procerus row'); eq(/midline 4\)/.test(rec),true,'record total shows midline');
eq(/Masseter, upper/.test(rec),false,'record skips optional 0 U site'); eq(/Masseter, center/.test(rec),true,'record has masseter center');
// consent is product-aware and has the under-18 line
r("S.lang='en';S.product='xeomin'"); let cs=r("docConsent()");
eq(/Xeomin is FDA-approved in adults/.test(cs),true,'xeomin approval'); eq(/under 18, every use on this form is off-label/.test(cs),true,'minors off-label');
eq(/Xeomin \(incobotulinumtoxinA\), a botulinum toxin type A/.test(cs),true,'consent sub');
r("S.lang='es'"); cs=r("docConsent()"); eq(/La FDA ha aprobado Xeomin/.test(cs),true,'es approval'); eq(/menores de 18/.test(cs),true,'es minors');
r("S.lang='en'"); eq(/Before and After Your Xeomin Treatment/.test(r("docAftercare()")),true,'aftercare title');
eq(r("PTXT.en.screening.q.length"),17,'screening 17 q'); eq(r("PTXT.es.screening.q.length"),17,'es screening 17 q');
// every site sits inside its range and every ref exists
const bad=r("(function(){var b=[];IND_ORDER.forEach(function(id){var ind=IND[id];ind.refs.forEach(function(k){if(!REFS[k])b.push(id+' ref '+k)});ind.points.forEach(function(p){['dose','doseR','doseL'].forEach(function(k){if(p[k]!=null&&(p[k]<p.min||p[k]>p.max))b.push(id+'.'+p.id+' '+k)});if(p.opt&&(p.dose||0)!==0)b.push(id+'.'+p.id+' opt not 0')})});return JSON.stringify(b)})()");
eq(bad,'[]','doses in range, refs exist');
console.log(fails?fails+' FAILED':'ALL PASS');
