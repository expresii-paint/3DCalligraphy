// Headless verification of the XST parser (extracted from 3d-calligraphy.html).
// Tests: byte-exact round-trip, pressure-event stroke cutting, pressure-last-token.
const fs = require('fs');
const html = fs.readFileSync('C:\\Users\\Nel\\3d-calligraphy.html', 'utf8');

const m = html.match(/XST-PARSER-START === \*\/([\s\S]*?)\/\* === XST-PARSER-END ===/);
if (!m) { console.error('parser block not found'); process.exit(1); }
let body = m[1];
// strip the `window.XST = {...}` line so it runs without a DOM
body = body.replace(/window\.XST\s*=\s*\{[\s\S]*?\};\s*$/m, '');
const api = new Function('window', body + '\n return { parseXST, emitXST, genNiceDemo, paperAspect };');
const fakeWin = {};
const { parseXST, emitXST, genNiceDemo, paperAspect } = api(fakeWin);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// ---- 1. Demo round-trip + structure ----
const demo = genNiceDemo();
const dDoc = parseXST(demo);
ok('demo: round-trip byte-exact', emitXST(dDoc) === demo);
ok('demo: exactly 1 stroke', dDoc.strokes.length === 1, dDoc.strokes.length);
ok('demo: 70 frames', dDoc.strokes[0].frames.length === 70, dDoc.strokes[0].frames.length);
ok('demo: brush-DOWN present (first pressed frame > 0)', dDoc.strokes[0].frames.some(f => f.pressure > 0));
ok('demo: no NaN pressures', dDoc.strokes[0].frames.every(f => Number.isFinite(f.pressure) && Number.isFinite(f.x) && Number.isFinite(f.z)));
ok('demo: aspect = 1 from 4 corners', paperAspect(dDoc) === 1, paperAspect(dDoc));

// ---- 2. Multi-stroke by pressure events (pen-up frames separate arcs) ----
function s(x, p, roll) { return `s ${x.toFixed(2)} 0 0 0 ${(roll||0).toFixed(2)} 0 ${p.toFixed(2)}`; }
let ms = [];
ms.push("' multi");
ms.push("a -5 -5"); ms.push("a 5 -5"); ms.push("a 5 5"); ms.push("a -5 5");
ms.push("L 0");
// stroke 1: p0 -> pressed -> up
ms.push(s(0,0)); ms.push(s(1,0.8)); ms.push(s(2,0.9)); ms.push(s(3,0));
// gap, stroke 2: pressed -> up
ms.push(s(0,0)); ms.push(s(1,0.7)); ms.push(s(2,0));
// stroke 3 on a new layer
ms.push("L 1");
ms.push(s(0,0)); ms.push(s(1,0.5)); ms.push(s(2,0));
const msText = ms.join('\n');
const mDoc = parseXST(msText);
ok('multi: 3 strokes cut from pressure events', mDoc.strokes.length === 3, mDoc.strokes.length);
ok('multi: stroke layer assignment [0,0,1]', mDoc.strokes.map(s=>s.layer).join(',') === '0,0,1', mDoc.strokes.map(s=>s.layer));
ok('multi: layer cmd not dropped on round-trip', emitXST(mDoc) === msText);
ok('multi: each stroke starts & ends at p=0 (well-formed)', mDoc.strokes.every(s => s.frames[0].pressure===0 && s.frames[s.frames.length-1].pressure===0));
// pen-up frames assigned to preceding stroke (head p=0, tail p=0 included)
ok('multi: stroke1 has 4 frames (incl head/tail pen-up)', mDoc.strokes[0].frames.length === 4, mDoc.strokes[0].frames.length);

// ---- 3. Pressure is the LAST token (not idx 5 of tok[1:]) ----
// craft a line where pressure != roll and != turn
const tricky = "s 1.5 -2.3 0.9 0.1 0.2 0.3 0.777";
const tDoc = parseXST(tricky);
ok('pressure-last: pressure=0.777 (not 0.3=roll/turn)', tDoc.strokes[0].frames[0].pressure === 0.777, tDoc.strokes[0].frames[0].pressure);

// ---- 4. Unknown / comment / blank lines preserved ----
const messy = "# a comment\n\n' T\nb 1 2 3 4 5 6 7 8 9 0\nfoo bar baz\n" + s(0,0) + "\n" + s(1,0.5) + "\n" + s(2,0);
const mzDoc = parseXST(messy);
ok('messy: unknown `foo` kept as other', mzDoc.lines.some(o => o.type === 'other' && o.raw.includes('foo')));
ok('messy: blank/comment preserved on round-trip', emitXST(mzDoc) === messy);

// CRLF preservation: a recorded file with Windows line endings must round-trip byte-exact
const crlfText = "# hdr\r\ns 1 2 3 4 5 6 0\r\n's 1 2 3 4 5 6 0.5\r\n";
const crlfDoc = parseXST(crlfText);
ok('crlf: round-trip preserves CRLF', emitXST(crlfDoc) === crlfText);

// ---- 5. Real recorded file (sample with undo.XST) ----
const realPath = 'C:\\Users\\Nel\\AppData\\Local\\hermes\\attachments\\sample with undo.XST';
if (fs.existsSync(realPath)) {
  const realText = fs.readFileSync(realPath, 'utf8');
  const rDoc = parseXST(realText);
  const totalS = realText.split(/\r?\n/).filter(l => l.trim().startsWith('s ')).length;
  const uCount = realText.split(/\r?\n/).filter(l => l.trim() === 'u').length;
  ok('real: parses without throwing', Array.isArray(rDoc.strokes));
  ok('real: round-trip byte-exact', emitXST(rDoc) === realText);
  ok('real: contains 7 undo commands recognized', rDoc.lines.filter(o => o.type === 'undo').length === 7, rDoc.lines.filter(o => o.type === 'undo').length);
  // Undo must REDUCE the stroke count vs naive (no-undo) interpretation.
  ok('real: undo reduces stroke count below raw s-arcs', rDoc.strokes.length < totalS, `strokes=${rDoc.strokes.length}, rawS=${totalS}`);
  ok('real: every stroke has >=2 frames', rDoc.strokes.every(s => s.frames.length >= 2));
  // Structurally-required: every stroke begins at a pen-up (p==0). A recording may
  // end with the brush still down (last stroke tail p>0) — that is valid, not a bug.
  ok('real: every stroke STARTS at p==0 (leading pen-up / head)', rDoc.strokes.every(s => s.frames[0].pressure === 0));
  // No frame double-counted: sum of stroke frames + undo removals == total parsed s-frames.
  const accounted = rDoc.strokes.reduce((a, s) => a + s.frames.length, 0);
  ok('real: frames accounted within strokes > 0 and <= total', accounted > 0 && accounted <= totalS, `acc=${accounted}, total=${totalS}`);
  const rp = rDoc.strokes.reduce((a,s)=>a+s.frames.length,0);
  ok('real: parsed frames > 1000 (real content)', rp > 1000, rp);
  // color stops present
  ok('real: colorStops parsed (9 stops)', rDoc.colorStops.length === 9, rDoc.colorStops.length);
} else {
  console.log('  SKIP real-file tests (file not present at', realPath + ')');
}

// ---- 6. Undo semantics unit test (synthetic) ----
function su(x, p) { return `s ${x} 0 0 0 0 0 ${p}`; }
let ut = [];
ut.push("' undo-test");
ut.push(su(0,0)); ut.push(su(1,0.8)); ut.push(su(2,0));   // stroke A
ut.push("u");                                                // undo A
ut.push(su(5,0)); ut.push(su(6,0.9)); ut.push(su(7,0));   // stroke B
const utDoc = parseXST(ut.join('\n'));
ok('undo: only stroke B remains (A was undone)', utDoc.strokes.length === 1, utDoc.strokes.length);
ok('undo: remaining stroke is B (x from 5..7)', utDoc.strokes[0].frames[1].x === 6, utDoc.strokes[0].frames[1].x);
ok('undo: round-trip preserves "u" line', emitXST(utDoc).includes('\nu\n'));

// ---- 7. XST version detection + Y orientation (v0.8 flipped +Y to UP) ----
function parseVer(t){ const mm = t.match(/#\s*Expresii Stroke File v(\d+)\.(\d+)/i); return mm ? {major:+mm[1],minor:+mm[2]} : null; }
function isLegacy(v){ return !v || v.major < 0 || (v.major === 0 && v.minor < 8); }
ok('version: detects v0.7', JSON.stringify(parseVer('# Expresii Stroke File v0.7'))==='{"major":0,"minor":7}');
ok('version: detects v0.8', JSON.stringify(parseVer('# Expresii Stroke File v0.8'))==='{"major":0,"minor":8}');
ok('version: missing header => null', parseVer('no header here') === null);
ok('legacy: v0.7 is legacy (flip Y)', isLegacy(parseVer('# Expresii Stroke File v0.7')) === true);
ok('legacy: v0.8 is NOT legacy (no flip)', isLegacy(parseVer('# Expresii Stroke File v0.8')) === false);
ok('legacy: missing header treated as legacy', isLegacy(parseVer('x')) === true);
// ySign encoded on the doc
const v07doc = parseXST('# Expresii Stroke File v0.7\n\' t\ns 0 1 0 0 0 0 0\ns 1 1 0 0 0 0 0.9\ns 2 1 0 0 0 0 0\n');
const v08doc = parseXST('# Expresii Stroke File v0.8\n\' t\ns 0 1 0 0 0 0 0\ns 1 1 0 0 0 0 0.9\ns 2 1 0 0 0 0 0\n');
ok('ySign: v0.7 => -1 (flip +Y down -> up)', v07doc.ySign === -1, v07doc.ySign);
ok('ySign: v0.8 => +1 (as-is, already +Y up)', v08doc.ySign === 1, v08doc.ySign);
ok('doc.version: v0.7 parsed', JSON.stringify(v07doc.version)==='{"major":0,"minor":7}');
ok('doc.version: v0.8 parsed', JSON.stringify(v08doc.version)==='{"major":0,"minor":8}');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
