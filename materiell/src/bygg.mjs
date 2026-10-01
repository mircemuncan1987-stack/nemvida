import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { ORD, KATEGORIER, BOKSTAVER, finn } from './ord.mjs';
import { CSS, bilde, farge, fitMm } from './bilde.mjs';

const ROT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UT = join(ROT, 'pdf');
mkdirSync(UT, { recursive: true });

const html = (kropp, ekstraCss = '') => {
  const land = kropp.includes('class="page land');
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><style>@page{size:A4${land ? ' landscape' : ''};margin:0}${CSS}${ekstraCss}</style></head><body>${kropp}</body></html>`;
};

// Enkel, deterministisk tilfeldighet slik at utskriftene blir like hver gang
let frø = 12345;
const rnd = () => ((frø = (frø * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const rydd = () => (frø = 12345);

// Plasser riktig svar til venstre/høyre uten mer enn to like på rad
function sideRekke(n) {
  const r = [];
  for (let i = 0; i < n; i++) {
    let s = rnd() < 0.5 ? 0 : 1;
    if (i >= 2 && r[i - 1] === r[i - 2]) s = 1 - r[i - 1];
    r.push(s);
  }
  return r;
}

// ---------- 1. Kort (bilde+ord, bare bilde, bare ord) ----------
const kortSide = (celler, kol, rad, bredde, høyde) => {
  const pr = kol * rad;
  const sider = [];
  for (let i = 0; i < celler.length; i += pr) {
    const rutene = celler.slice(i, i + pr).map((c) => `<div class="rute">${c}</div>`).join('');
    sider.push(`<div class="page"><div class="rutenett">${rutene}</div><div class="fot">Klipp langs de stiplede linjene</div></div>`);
  }
  const css = `
    .rutenett{position:absolute;left:${(210 - kol * bredde) / 2}mm;top:${(297 - rad * høyde) / 2}mm;display:grid;grid-template-columns:repeat(${kol},${bredde}mm);grid-auto-rows:${høyde}mm}
    .rute{border:.3mm dashed #888;padding:2.5mm}
    .kort{width:100%;height:100%;border:1.4mm solid;border-radius:5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5mm}
  `;
  return html(sider.join(''), css);
};

const kortBildeOrd = (o, bredde, høyde) => {
  const f = farge(o);
  const bild = Math.min(høyde - 28, bredde - 30);
  return `<div class="kort" style="border-color:${f.farge};background:${f.lys}">${bilde(o.e, bild)}<div class="ord" style="font-size:${fitMm(o.w, 15, bredde - 14)}mm">${o.w}</div></div>`;
};
const kortBilde = (o, bredde, høyde) => {
  const f = farge(o);
  return `<div class="kort" style="border-color:${f.farge};background:#fff">${bilde(o.e, Math.min(bredde, høyde) - 18)}</div>`;
};
const kortOrd = (o, bredde) => {
  const f = farge(o);
  return `<div class="kort" style="border-color:${f.farge};background:#fff"><div class="ord" style="font-size:${fitMm(o.w, 15, bredde - 26)}mm">${o.w}</div></div>`;
};

// ---------- 2. Velg riktig ord ----------
function velgOrdArk() {
  rydd();
  const sider = [];
  const pr = 5;
  const oppgaver = ORD.map((o) => {
    const kand = ORD.filter((x) => x.w !== o.w && x.k !== o.k && x.w[0] !== o.w[0])
      .sort((a, b) => Math.abs(a.w.length - o.w.length) - Math.abs(b.w.length - o.w.length));
    const alt = kand[Math.floor(rnd() * Math.min(6, kand.length))];
    return { o, alt };
  });
  const sidePlass = sideRekke(oppgaver.length);
  oppgaver.forEach((t, i) => (t.side = sidePlass[i]));
  for (let i = 0; i < oppgaver.length; i += pr) {
    const rader = oppgaver.slice(i, i + pr).map((t, j) => {
      const nr = i + j + 1;
      const valg = t.side === 0 ? [t.o, t.alt] : [t.alt, t.o];
      const bokser = valg.map((v) => `<div class="valg"><div class="ord" style="font-size:${fitMm(v.w, 14, 54)}mm">${v.w}</div></div>`).join('');
      return `<div class="rad" style="top:${32 + j * 50}mm"><div class="nr">${nr}</div><div class="bildeboks" style="border-color:${farge(t.o).farge}">${bilde(t.o.e, 34)}</div>${bokser}</div>`;
    }).join('');
    sider.push(`<div class="page"><div class="tittel">Velg riktig ord <span>Sett ring rundt ordet som passer til bildet.</span></div>${rader}<div class="fot">Navn: ______________________ &nbsp;&nbsp; Dato: ____________</div></div>`);
  }
  // Fasit
  const fasit = oppgaver.map((t, i) => `<li><b>${i + 1}.</b> ${t.o.w} <i>(ikke: ${t.alt.w}; riktig står til ${t.side === 0 ? 'venstre' : 'høyre'})</i></li>`).join('');
  sider.push(`<div class="page"><div class="tittel">Fasit <span>Kun for voksne</span></div><ol class="fasit">${fasit}</ol></div>`);
  const css = `
    .tittel{position:absolute;left:12mm;top:9mm;right:12mm;font-size:9mm;font-weight:700}
    .tittel span{display:block;font-size:4.6mm;font-weight:400;color:#555;margin-top:1mm}
    .rad{position:absolute;left:12mm;right:12mm;display:flex;gap:7mm;align-items:center;height:46mm}
    .nr{width:7mm;font-size:5mm;color:#777;text-align:right}
    .bildeboks{width:44mm;height:44mm;border:1.2mm solid;border-radius:5mm;display:flex;align-items:center;justify-content:center}
    .valg{flex:1;height:36mm;border:.9mm solid #333;border-radius:5mm;display:flex;align-items:center;justify-content:center}
    .fasit{position:absolute;left:18mm;top:32mm;columns:2;column-gap:12mm;list-style:none;font-size:4.4mm;line-height:1.7}
  `;
  return html(sider.join(''), css);
}

// ---------- 3. Lettbøker ----------
const BØKER = [
  {
    fil: 'bok1_jeg_vil_ha', tittel: 'Jeg vil ha', forside: ['🥛', '🍌', '⚽'],
    sider: [
      ['Jeg vil ha {}.', 'melk', 'brød'], ['Jeg vil ha {}.', 'vann', 'mat'], ['Jeg vil ha {}.', 'brød', 'is'],
      ['Jeg vil ha {}.', 'is', 'melk'], ['Jeg vil ha en {}.', 'banan', 'ball'], ['Jeg vil ha en {}.', 'ball', 'banan'],
      ['Jeg vil ha et {}.', 'eple', 'nettbrett'], ['Jeg vil ha et {}.', 'nettbrett', 'eple'],
    ],
  },
  {
    fil: 'bok2_jeg_er', tittel: 'Jeg er', forside: ['😀', '😢', '😠'],
    sider: [
      ['Jeg er {}.', 'glad', 'trist'], ['Jeg er {}.', 'trist', 'sint'], ['Jeg er {}.', 'sint', 'glad'],
      ['Jeg er {}.', 'redd', 'trøtt'], ['Jeg er {}.', 'trøtt', 'sulten'], ['Jeg er {}.', 'sulten', 'redd'],
      ['Jeg er {}.', 'varm', 'kald'], ['Jeg er {}.', 'kald', 'varm'],
    ],
    lesesider: [['Jeg har vondt.', 'vondt']],
  },
  {
    fil: 'bok3_jeg_vil', tittel: 'Jeg vil', forside: ['🍽️', '😴', '🧸'],
    sider: [
      ['Jeg vil {}.', 'spise', 'sove'], ['Jeg vil {}.', 'drikke', 'leke'], ['Jeg vil {}.', 'sove', 'gå'],
      ['Jeg vil {}.', 'leke', 'tegne'], ['Jeg vil {}.', 'gå', 'sitte'], ['Jeg vil {}.', 'sitte', 'se'],
      ['Jeg vil {}.', 'tegne', 'vaske'], ['Jeg vil {}.', 'vaske', 'drikke'],
    ],
  },
  {
    fil: 'bok4_jeg_ser', tittel: 'Jeg ser', forside: ['🚗', '🐶', '🍎'],
    sider: [
      ['Jeg ser en {}.', 'bil', 'ball'], ['Jeg ser en {}.', 'hund', 'bok'], ['Jeg ser en {}.', 'sko', 'seng'],
      ['Jeg ser en {}.', 'banan', 'bil'], ['Jeg ser en {}.', 'ball', 'sko'], ['Jeg ser et {}.', 'eple', 'brød'],
      ['Jeg ser et {}.', 'brød', 'nettbrett'], ['Jeg ser et {}.', 'nettbrett', 'eple'],
    ],
  },
];

function bokHtml(bok, nivå) {
  rydd();
  const plass = sideRekke(bok.sider.length);
  const sider = [];
  sider.push(`<div class="page land forside"><div class="ft">${bok.tittel}…</div><div class="fb">${bok.forside.map((e) => bilde(e, 52)).join('')}</div><div class="fn">Lettlest bok · nivå ${nivå}${nivå === 1 ? ' (bilde ved ordene)' : ' (bare ord)'}</div></div>`);
  bok.sider.forEach(([setning, riktig, feil], i) => {
    const r = finn(riktig);
    const f = finn(feil);
    const valg = plass[i] === 0 ? [r, f] : [f, r];
    const boks = valg.map((v) => {
      const tekst = `<div class="ord" style="font-size:${fitMm(v.w, 24, nivå === 1 ? 82 : 120)}mm">${v.w}</div>`;
      return `<div class="valgb">${nivå === 1 ? bilde(v.e, 28) : ''}${tekst}</div>`;
    }).join('');
    const [før, etter] = setning.split('{}');
    sider.push(`<div class="page land bs"><div class="venstre" style="border-color:${farge(r).farge};background:${farge(r).lys}">${bilde(r.e, 100)}</div><div class="høyre"><div class="setn">${før}<span class="gap"></span>${etter}</div>${boks}</div><div class="fot">${bok.tittel} · side ${i + 1}</div></div>`);
  });
  (bok.lesesider || []).forEach(([setning, ord], i) => {
    const o = finn(ord);
    sider.push(`<div class="page land bs"><div class="venstre" style="border-color:${farge(o).farge};background:${farge(o).lys}">${bilde(o.e, 100)}</div><div class="høyre lese"><div class="setn stor">${setning}</div></div><div class="fot">${bok.tittel} · lesing</div></div>`);
  });
  sider.push(`<div class="page land forside"><div class="ft">Bra jobbet!</div><div class="fb">${bilde('🎉', 70)}${bilde('👏', 70)}</div></div>`);
  const fasit = bok.sider.map(([s, r, f], i) => `<li><b>${i + 1}.</b> ${s.replace('{}', '<u>' + r + '</u>')} <i>(ikke: ${f}; riktig står til ${plass[i] === 0 ? 'venstre' : 'høyre'})</i></li>`).join('');
  sider.push(`<div class="page land"><div class="ftit">Fasit – ${bok.tittel} (kun for voksne)</div><ol class="fas">${fasit}</ol></div>`);
  const css = `
    .forside{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12mm;background:#fffdf4}
    .ft{font-size:30mm;font-weight:700}
    .fb{display:flex;gap:14mm}
    .fn{font-size:7mm;color:#555}
    .bs .venstre{position:absolute;left:12mm;top:12mm;width:124mm;height:182mm;border:2mm solid;border-radius:8mm;display:flex;align-items:center;justify-content:center}
    .bs .høyre{position:absolute;left:146mm;top:12mm;width:139mm;height:182mm;display:flex;flex-direction:column;gap:9mm}
    .setn{height:50mm;font-size:15mm;font-weight:700;line-height:1.25;display:flex;align-items:center;flex-wrap:wrap;gap:0 3mm}
    .setn.stor{font-size:21mm;height:182mm}
    .gap{display:inline-block;width:42mm;border-bottom:1.6mm solid #111;height:14mm}
    .valgb{flex:1;border:1mm solid #333;border-radius:7mm;display:flex;align-items:center;justify-content:center;gap:10mm}
    .lese{justify-content:center}
    .ftit{position:absolute;left:14mm;top:10mm;font-size:8mm;font-weight:700}
    .fas{position:absolute;left:20mm;top:30mm;list-style:none;font-size:5mm;line-height:1.8}
  `;
  return html(sider.join(''), css);
}

// ---------- 4. Kommunikasjonstavle ----------
function tavleHtml() {
  const rekkefølge = ['sosial', 'person', 'verb', 'ting', 'fole'];
  const sortert = [...ORD].sort((a, b) => rekkefølge.indexOf(a.k) - rekkefølge.indexOf(b.k));
  const flis = (o) => `<div class="flis" style="border-color:${farge(o).farge};background:${farge(o).lys}">${bilde(o.e, 21)}<div class="ord" style="font-size:${fitMm(o.w, 7.5, 32)}mm">${o.w}</div></div>`;
  const sider = [];
  for (let i = 0; i < sortert.length; i += 35) {
    sider.push(`<div class="page land"><div class="tavle">${sortert.slice(i, i + 35).map(flis).join('')}</div><div class="fot">Kommunikasjonstavle ${i === 0 ? '1' : '2'} av 2 · fargene: rosa = sosiale ord, gul = personer, grønn = handlinger, oransje = ting/mat/steder, blå = følelser</div></div>`);
  }
  const stripe = (start, slotTekst) => `<div class="stripe"><div class="flis start"><div class="ord" style="font-size:8.5mm;white-space:normal;line-height:1.15">${start}</div></div><div class="slot">${slotTekst}</div></div>`;
  sider.push(`<div class="page land"><div class="ftit">Setningsstriper – legg en flis fra tavlen i den tomme ruten</div>${stripe('Jeg vil ha', '')}${stripe('Jeg vil', '')}${stripe('Jeg er', '')}${stripe('Jeg har', '')}</div>`);
  const css = `
    .tavle{position:absolute;left:15.5mm;top:10mm;display:grid;grid-template-columns:repeat(7,38mm);grid-auto-rows:38mm}
    .flis{width:38mm;height:38mm;border:1.1mm solid;border-radius:4mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;outline:.3mm dashed #999;outline-offset:.4mm}
    .ftit{position:absolute;left:15mm;top:8mm;font-size:7mm;font-weight:700}
    .stripe{position:relative;margin:0 15mm;height:38mm;display:flex;gap:6mm;align-items:center}
    .page .stripe:nth-of-type(2){top:20mm}.page .stripe:nth-of-type(3){top:32mm}.page .stripe:nth-of-type(4){top:44mm}.page .stripe:nth-of-type(5){top:56mm}
    .start{background:#f1f1f1;border-color:#555}
    .slot{width:38mm;height:38mm;border:1mm dashed #666;border-radius:4mm}
  `;
  return html(sider.join(''), css);
}

// ---------- 5. Bokstavkort ----------
function bokstavHtml() {
  const kort = BOKSTAVER.map(([b, ord, e]) => `<div class="kort bst"><div class="bokst">${b}${b.toLowerCase()}</div>${bilde(e, 30)}<div class="ord" style="font-size:12mm">${ord}</div></div>`);
  const dobbel = [];
  const sider = [];
  for (let i = 0; i < kort.length; i += 6) {
    sider.push(`<div class="page"><div class="rutenett">${kort.slice(i, i + 6).map((c) => `<div class="rute">${c}</div>`).join('')}</div><div class="fot">Bokstavkort · klipp langs de stiplede linjene</div></div>`);
  }
  const css = `
    .rutenett{position:absolute;left:5mm;top:16.5mm;display:grid;grid-template-columns:repeat(2,100mm);grid-auto-rows:88mm}
    .rute{border:.3mm dashed #888;padding:2.5mm}
    .kort{width:100%;height:100%;border:1.4mm solid #333;border-radius:5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm}
    .bokst{font-size:32mm;font-weight:700;line-height:1;letter-spacing:.06em;color:#1f66cc}
  `;
  return html(sider.join(''), css);
}

// ---------- 6. Veiledning + oversikt ----------
function veiledningHtml() {
  const radene = Object.entries(KATEGORIER).map(([k, kat]) => {
    const ord = ORD.filter((o) => o.k === k).map((o) => `<span class="chip" style="border-color:${kat.farge};background:${kat.lys}">${bilde(o.e, 9)}<b>${o.w}</b></span>`).join('');
    return `<div class="gruppe"><div class="gnavn" style="color:${kat.farge}">${kat.navn}</div>${ord}</div>`;
  }).join('');
  const side1 = `<div class="page tekst">
    <h1>Ord for hverdagen</h1>
    <p class="ingress">Utskriftbart materiell for bokstav- og ordinnlæring. Alt bygger på de samme 50 høyfrekvente ordene, slik at barnet møter hvert ord igjen og igjen i ulike sammenhenger.</p>
    <h2>Anbefalt rekkefølge</h2>
    <ol>
      <li><b>Bilde–bilde.</b> Parr like bildekort (skriv ut «Bildekort» to ganger).</li>
      <li><b>Bilde–ord.</b> Legg ordkortet oppå det bildekortet det passer til.</li>
      <li><b>Velg riktig ord.</b> To valg for hvert bilde. Barnet peker, ser på eller setter ring rundt det riktige ordet.</li>
      <li><b>Lettleste bøker.</b> Start med nivå 1 (bilde ved ordene), gå deretter til nivå 2 (bare ord).</li>
      <li><b>Bruk ordene i hverdagen.</b> Kommunikasjonstavlen og setningsstripene skal være tilgjengelige der tingene skjer, ikke bare i lesetid.</li>
    </ol>
    <h2>Slik arbeider du</h2>
    <ul>
      <li>Ta inn 3–5 ord om gangen. Begynn med ord som er viktige for ham, for eksempel <i>mer</i>, <i>ferdig</i>, <i>eple</i> og <i>ball</i>.</li>
      <li>Hold øktene korte, 5–10 minutter, og ofte. Avslutt mens det går bra.</li>
      <li>Gi hjelp før han gjør feil: pek på det riktige kortet, la ham gjøre valget selv, og trekk hjelpen gradvis tilbake. Unngå å si «nei» eller «feil». Vis det riktige og prøv igjen.</li>
      <li>Godta hans måte å svare på: peking, blikk, å legge eller å ta kortet.</li>
      <li>La ordene få en virkning. Når han velger <i>eple</i>, får han eple. Da forstår han at ordene fungerer.</li>
      <li>Tommelfingerregel: ta inn et nytt ord når han klarer det riktig 4 av 5 ganger to dager på rad.</li>
    </ul>
    <h2>Tips til utskrift</h2>
    <ul>
      <li>Skriv ut i A4 og i <b>faktisk størrelse</b> (100 %), ikke «tilpass til siden».</li>
      <li>Bruk gjerne tykkere papir (160–200 g) til kortene, og laminer. Borrelås på baksiden gjør kortene til en tavle.</li>
      <li>Farge er best, men det fungerer også i svart-hvitt.</li>
    </ul>
    <div class="boks"><b>Viktig:</b> Kommunikasjon kommer først. Snakk med logoped, PPT eller habiliteringstjenesten om alternativ og supplerende kommunikasjon (ASK), og om hvilket symbolsett skolen bruker, slik at bildene er like overalt. Bildene i denne pakken er emoji-bilder. De kan byttes ut med symboler fra for eksempel ARASAAC eller Widgit.</div>
  </div>`;
  const side2 = `<div class="page tekst"><h1>De 50 ordene</h1><p class="ingress">Fargene følger en vanlig ASK-standard (modifisert Fitzgerald-nøkkel), slik at ordklassene alltid har samme farge.</p>${radene}</div>`;
  const css = `
    .tekst{padding:12mm 16mm;font-size:4.1mm;line-height:1.4}
    h1{font-size:12mm;margin-bottom:3mm}
    h2{font-size:5.8mm;margin:4mm 0 1.5mm;color:#1f66cc}
    .ingress{font-size:5mm;color:#444;margin-bottom:2mm}
    ol,ul{padding-left:6mm} li{margin-bottom:1mm}
    .boks{margin-top:5mm;padding:3mm 4mm;border:.8mm solid #c99a00;background:#fff6d6;border-radius:3mm}
    .gruppe{margin-top:5mm} .gnavn{font-weight:700;font-size:5.4mm;margin-bottom:2mm}
    .chip{display:inline-flex;align-items:center;gap:1.5mm;border:.8mm solid;border-radius:3mm;padding:1mm 3mm 1mm 1.5mm;margin:0 2mm 2mm 0;font-size:5mm}
  `;
  return html(side1 + side2, css);
}

// ---------- Kjør ----------
const jobber = [
  ['00_veiledning_og_oversikt', veiledningHtml()],
  ['01_ordkort_bilde_og_ord', kortSide(ORD.map((o) => kortBildeOrd(o, 97, 68)), 2, 4, 97, 68)],
  ['02_bildekort_kun_bilde', kortSide(ORD.map((o) => kortBilde(o, 65, 68)), 3, 4, 65, 68)],
  ['03_ordkort_kun_ord', kortSide(ORD.map((o) => kortOrd(o, 65)), 3, 5, 65, 50)],
  ['04_velg_riktig_ord', velgOrdArk()],
  ['05_kommunikasjonstavle', tavleHtml()],
  ['06_bokstavkort', bokstavHtml()],
  ...BØKER.flatMap((b, i) => [1, 2].map((n) => [`${String(10 + i * 2 + n - 1)}_${b.fil}_niva${n}`, bokHtml(b, n)])),
];

const nettleser = await chromium.launch();
for (const [navn, innhold] of jobber) {
  const side = await nettleser.newPage();
  await side.setContent(innhold, { waitUntil: 'load' });
    await side.pdf({ path: join(UT, navn + '.pdf'), printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await side.close();
  console.log('ok', navn);
}
await nettleser.close();
