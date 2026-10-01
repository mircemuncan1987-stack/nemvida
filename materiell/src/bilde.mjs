import { KATEGORIER } from './ord.mjs';

// Fitzgerald-farge for et ord
export const farge = (o) => KATEGORIER[o.k];

// Omtrentlig bredde (i mm) for en tekststreng i Liberation Sans, for å tilpasse skriftstørrelse.
export const fitMm = (tekst, maxMm, breddeMm) => Math.min(maxMm, breddeMm / (tekst.length * 0.6));

const SVG = {
  xylofon: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="40" width="80" height="3" fill="#8a6a4a"/><rect x="10" y="72" width="80" height="3" fill="#8a6a4a"/><rect x="12" y="22" width="11" height="68" rx="3" fill="#d6247f"/><rect x="26" y="28" width="11" height="62" rx="3" fill="#e8760f"/><rect x="40" y="34" width="11" height="56" rx="3" fill="#f2c200"/><rect x="54" y="40" width="11" height="50" rx="3" fill="#2a8f3a"/><rect x="68" y="46" width="11" height="44" rx="3" fill="#1f66cc"/><rect x="82" y="52" width="8" height="38" rx="3" fill="#7a3fb5"/></svg>`,
  nettbrett: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="18" width="84" height="64" rx="8" fill="#2b2f36"/><rect x="14" y="24" width="72" height="52" rx="3" fill="#8fd0ff"/><circle cx="50" cy="50" r="10" fill="#fff" opacity=".85"/><circle cx="89" cy="50" r="1.6" fill="#8b929c"/></svg>`,
  stor: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="44" cy="52" r="40" fill="#1f66cc"/><circle cx="90" cy="82" r="8" fill="#cfd6e0"/></svg>`,
  liten: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="44" cy="52" r="40" fill="#cfd6e0"/><circle cx="90" cy="82" r="8" fill="#1f66cc"/></svg>`,
};

// Bilde med gitt størrelse i mm
export function bilde(e, mm) {
  if (e.startsWith('svg:')) {
    return `<span class="bilde" style="width:${mm}mm;height:${mm}mm">${SVG[e.slice(4)]}</span>`;
  }
  return `<span class="bilde emoji" style="width:${mm}mm;height:${mm}mm;font-size:${mm * 0.78}mm;line-height:${mm}mm">${e}</span>`;
}

export const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { font-family: 'Liberation Sans', Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { width: 210mm; height: 297mm; position: relative; overflow: hidden; page-break-after: always }
.page.land { width: 297mm; height: 210mm }
.page:last-child { page-break-after: auto }
.bilde { display: inline-block; text-align: center }
.bilde svg { width: 100%; height: 100% }
.emoji { font-family: 'Noto Color Emoji', sans-serif }
.ord { font-weight: 700; letter-spacing: .03em; white-space: nowrap; text-align: center }
.fot { position: absolute; bottom: 5mm; left: 0; right: 0; text-align: center; font-size: 3.6mm; color: #777 }
.abs { position: absolute }
`;
