// Hub page of the headset lab: renders the test catalogue (tests.js), the server status (/api/status) and the feedback
// already given (/api/results); the verdict buttons POST same-origin to /api/results. Note drafts are kept in
// localStorage (best effort), because the page is left for every test and may reload on return.
import { GROUPS, VERDICTS } from './tests.js';

const $ = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};
const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} },
};
const when = iso => { try { return new Date(iso).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; } };
const results = new Map(); // test id -> entries (oldest first)

async function json(url, options) {
  const res = await fetch(url, { cache: 'no-store', ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---- status ----
const mark = state => state === 'ok' ? $('span', { class: 'st ok', text: '✓' }) : state === 'error' ? $('span', { class: 'st bad', text: '✗' }) : $('span', { class: 'st wait', text: '…' });
async function renderStatus() {
  const box = document.getElementById('status');
  let s;
  try { s = await json('/api/status'); } catch (e) { box.replaceChildren($('p', { class: 'err', text: `Serveren svarer ikke (${e.message}). Kører testlab på PC'en?` })); return; }
  const app = (id, name) => {
    const a = s.apps[id];
    if (!a) return null;
    return $('span', {}, mark(a.state), ` ${name}`, a.state === 'error' ? $('span', { class: 'err', text: ` – ${a.error}` }) : a.state === 'ok' ? '' : ' starter …');
  };
  const rec = (info, label, unit) => info?.exists ? `${label}: ${info.count ?? '?'} ${unit}, senest ${when(info.mtime)}` : `${label}: ingen endnu`;
  const syncText = { ok: `synk ok ${s.sync.at ? when(s.sync.at) : ''}`, error: 'synk fejlede (se PC-vinduet)', running: 'synker …', pending: 'synk venter', disabled: 'synk slået fra' }[s.sync.state] || '';
  const pub = s.published || {};
  const pubText = { unchanged: 'cloud-siden har den rigtige adresse', published: 'adressen er lagt på cloud-siden', running: 'lægger adressen på cloud-siden …', failed: `cloud-opdatering fejlede: ${pub.error}`, skipped: `cloud-opdatering sprunget over: ${pub.error}`, disabled: 'cloud-opdatering slået fra' }[pub.state] || '';
  const syncBtn = $('button', { class: 'plain', text: 'Synk apps igen', onclick: async () => {
    syncBtn.disabled = true; syncBtn.textContent = 'Synker …';
    try { await json('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch (e) { alert(`Synk fejlede: ${e.message}`); }
    syncBtn.disabled = false; syncBtn.textContent = 'Synk apps igen'; renderStatus();
  } });
  box.replaceChildren(
    $('div', { class: 'row' }, $('b', { text: 'Server:' }), app('demo', 'Flaskedemo'), app('studio', 'Grasp Studio'), app('contracts', 'Contracts')),
    $('p', { class: 'muted' }, `VRM-model Jimmy: `, s.extras.vrmModel ? 'på plads' : $('span', { class: 'err', text: 'mangler (se README)' }),
      ` · CC-avatar: `, s.extras.ccAvatar ? 'på plads' : $('span', { class: 'err', text: 'mangler' })),
    $('p', { class: 'muted', text: `${rec(s.extras.recordedGrasps, 'Optagede greb', 'poser')} · ${rec(s.extras.recordedHand, 'Hånd-klip', 'klip')}` }),
    $('p', { class: 'muted', text: `Adresse: ${s.url} · ${syncText} · ${pubText}` }),
    $('p', { class: 'muted', text: 'Ét certifikat for hele labbet (én port): advarslen «forbindelsen er ikke privat» accepteres én gang (Avanceret → Fortsæt) og gælder demo, studio og Contracts.' }),
    syncBtn,
  );
  document.getElementById('results-file').textContent = s.resultsFile;
}

// ---- tests ----
function historyOf(id) {
  const list = results.get(id) || [];
  if (!list.length) return $('div', { class: 'history muted', text: 'Ikke rapporteret endnu.' });
  return $('div', { class: 'history' }, list.slice(-5).reverse().map(e => $('p', {},
    $('span', { class: `v-${e.verdict}`, text: VERDICTS[e.verdict] || e.verdict }), ` ${when(e.at)}`, e.link ? $('span', { class: 'muted', text: ` · ${e.link}` }) : '', e.note ? ` – ${e.note}` : '')));
}

function renderTest(test) {
  const key = `gs-lab-note:${test.id}`;
  const note = $('textarea', { placeholder: 'Note (valgfri): hvad så du? Tal, niveau, hånd …', 'aria-label': `Note til ${test.title}` });
  note.value = store.get(key);
  note.addEventListener('input', () => store.set(key, note.value));
  const status = $('span', { class: 'sent' });
  const card = $('article', { class: 'test', id: `t-${test.id}` });
  let lastLink = store.get(`gs-lab-link:${test.id}`);
  const links = $('div', { class: 'links' }, test.links.map(([label, href]) => $('a', { href, onclick: () => { lastLink = href; store.set(`gs-lab-link:${test.id}`, href); store.set('gs-lab-last', test.id); } }, label)));
  const buttons = Object.entries(VERDICTS).map(([verdict, label]) => $('button', { class: verdict, type: 'button', onclick: async () => {
    buttons.forEach(b => { b.disabled = true; });
    status.textContent = 'Sender …'; status.className = 'sent';
    try {
      const { entry } = await json('/api/results', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: test.id, verdict, note: note.value.trim(), link: lastLink || undefined }) });
      (results.get(test.id) || results.set(test.id, []).get(test.id)).push(entry);
      note.value = ''; store.set(key, '');
      status.textContent = `Gemt: ${label} ✓`;
      refreshCard(card, test);
    } catch (e) { status.textContent = `Kunne ikke gemme: ${e.message}`; status.className = 'err'; }
    buttons.forEach(b => { b.disabled = false; });
  } }, label));
  card.append($('h3', { text: test.title }), links, $('ul', { class: 'check' }, test.check.map(c => $('li', { text: c }))), note,
    $('div', { class: 'verdicts' }, buttons, status), historyOf(test.id));
  refreshCard(card, test);
  return card;
}

function refreshCard(card, test) {
  const last = (results.get(test.id) || []).at(-1);
  card.classList.remove('done-virker', 'done-fejl', 'done-delvist');
  if (last) card.classList.add(`done-${last.verdict}`);
  card.querySelector('.history')?.replaceWith(historyOf(test.id));
}

async function renderTests() {
  try {
    const { entries } = await json('/api/results');
    for (const e of entries) (results.get(e.id) || results.set(e.id, []).get(e.id)).push(e);
  } catch {}
  document.getElementById('toc').replaceChildren(...GROUPS.map(g => $('a', { href: `#g-${g.id}`, text: g.title })));
  document.getElementById('groups').replaceChildren(...GROUPS.map(g => $('section', { class: 'group', id: `g-${g.id}` },
    $('div', { class: 'group-head' }, $('h2', { text: g.title }), $('span', { class: 'tag', text: g.step })),
    $('p', { class: 'intro', text: g.intro }),
    g.tests.map(renderTest))));
  // Back from a test: scroll to the card that was opened.
  const last = store.get('gs-lab-last');
  if (last && !location.hash) document.getElementById(`t-${last}`)?.scrollIntoView({ block: 'start' });
}

renderStatus();
renderTests();
setInterval(renderStatus, 15000);
addEventListener('pageshow', e => { if (e.persisted) renderStatus(); });
