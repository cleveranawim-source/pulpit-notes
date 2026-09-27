import * as pdfjs from '../../vendor/pdf.min.mjs';
import fs from 'fs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
const file = process.argv[2];
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), standardFontDataUrl: new URL('../../vendor/standard_fonts/', import.meta.url).pathname }).promise;
const out = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const [x0, y0, W, H] = page.view;
  const tc = await page.getTextContent();
  // 글자 하나씩 위치: 항목 폭을 글자 수로 나눠 배분
  const chars = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const [a, , , d, e, f] = it.transform;
    const n = [...it.str].length;
    [...it.str].forEach((ch, i) => chars.push({ ch, x: e + (it.width * i) / n, w: it.width / n, y: f, fs: Math.abs(d) || Math.abs(a) }));
  }
  out.push({ page: p - 1, W, H, chars });
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log(out.map(o => o.chars.length).join(','));
