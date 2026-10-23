// ☁️ データ きょうゆう（Firebase Firestore）
//   ・ID を いれると、すすみぐあい・メダル・とった こえ を その ID で ウェブに ほぞんする
//   ・おなじ ID を ほかの スマホで いれると、おなじ データに なる
//   ・すすみぐあいは「たしざん」で まぜる（クリアした だん・メダルの かいすうは おおきい ほう）
//   ・ID を しっている ひとは だれでも よみかき できるので、かぞく だけの ひみつに する
window.Cloud = (() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const cfg = window.CLOUD_CONFIG || {};
  const configured = !!(cfg.apiKey && cfg.projectId);
  const BASE = `${cfg.endpoint || 'https://firestore.googleapis.com/v1'}/projects/${cfg.projectId}/databases/(default)/documents`;
  const ID_KEY = 'cloud-id';
  const VB = window.VoiceBox;

  let id = '';
  try { id = localStorage.getItem(ID_KEY) || ''; } catch (e) { /* むし */ }
  let game = null;
  let busy = null;
  let choosing = null;   // えらぶ がめんを だしている あいだは じどうで まぜない
  let state = { ok: null, at: 0, msg: '' };

  // ---- Firestore REST ----
  async function req(method, path, body, params = '') {
    const url = `${BASE}/${path}?key=${encodeURIComponent(cfg.apiKey)}${params}`;
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`http ${r.status}`);
    return method === 'DELETE' ? true : r.json();
  }
  const S = v => ({ stringValue: String(v) });
  const I = v => ({ integerValue: String(Math.round(v)) });
  const B = v => ({ booleanValue: !!v });
  const val = f => {
    if (!f) return undefined;
    if ('stringValue' in f) return f.stringValue;
    if ('integerValue' in f) return Number(f.integerValue);
    if ('booleanValue' in f) return f.booleanValue;
    if ('bytesValue' in f) return f.bytesValue;
    return undefined;
  };
  const acct = () => `accounts/${encodeURIComponent(id)}`;

  // ---- すすみぐあい ----
  function mergeSave(a, b) {
    // 「さいしょから」に した ほうが あたらしければ、そちらを つかう
    if ((a.resetAt || 0) !== (b.resetAt || 0)) return (a.resetAt || 0) > (b.resetAt || 0) ? a : b;
    const caught = { ...(a.caught || {}) };
    for (const [k, n] of Object.entries(b.caught || {})) caught[k] = Math.max(caught[k] || 0, n);
    return {
      ...a,
      unlocked: Math.max(a.unlocked || 0, b.unlocked || 0),
      cleared: [...new Set([...(a.cleared || []), ...(b.cleared || [])])].sort((x, y) => x - y),
      caught,
      introSeen: !!(a.introSeen || b.introSeen),
      ending: Math.max(a.ending || 0, b.ending || 0),
    };
  }
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  async function syncSave() {
    const doc = await req('GET', acct());
    const remote = doc && doc.fields && val(doc.fields.save) ? JSON.parse(val(doc.fields.save)) : null;
    const local = game.get();
    const merged = remote ? mergeSave(local, remote) : local;
    if (!same(merged, local)) game.set(merged);
    if (!remote || !same(merged, remote)) {
      await req('PATCH', acct(), { fields: { save: S(JSON.stringify(merged)), updated: I(Date.now()) } });
    }
  }

  // ---- とった こえ ----
  async function docId(key) {
    const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(key));
    return [...new Uint8Array(h)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function listVoices() {
    const out = new Map();
    let token = '';
    const mask = ['key', 'by', 'at', 'deleted'].map(f => `&mask.fieldPaths=${f}`).join('');
    do {
      const r = await req('GET', `${acct()}/voices`, null, `&pageSize=300${mask}${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
      for (const d of (r && r.documents) || []) {
        const f = d.fields || {};
        out.set(val(f.key), { doc: d.name.split('/').pop(), by: val(f.by) || '', at: val(f.at) || 0, deleted: !!val(f.deleted) });
      }
      token = r && r.nextPageToken;
    } while (token);
    return out;
  }
  const toBase64 = b => new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.readAsDataURL(b);
  });

  async function syncVoices() {
    if (!VB) return;
    await VB.ready;
    const remote = await listVoices();
    const local = VB.meta();
    const tombs = VB.tombstones();
    // あげる
    for (const [k, m] of local) {
      const r = remote.get(k);
      if (r && r.at >= m.at) continue;
      const b = await VB.blob(k);
      if (!b) continue;
      await req('PATCH', `${acct()}/voices/${await docId(k)}`, {
        fields: { key: S(k), by: S(m.by || ''), at: I(m.at), deleted: B(false), data: { bytesValue: await toBase64(b) } },
      });
    }
    for (const [k, at] of Object.entries(tombs)) {
      const r = remote.get(k);
      if (r && !r.deleted && r.at < at) {
        await req('PATCH', `${acct()}/voices/${r.doc}`, { fields: { key: S(k), by: S(''), at: I(at), deleted: B(true) } });
      }
    }
    // もらう
    for (const [k, r] of remote) {
      const m = local.get(k);
      if (r.deleted) {
        if (m && m.at < r.at) await VB.remove(k, r.at);
        continue;
      }
      if ((m && m.at >= r.at) || (!m && (tombs[k] || 0) >= r.at)) continue;
      const d = await req('GET', `${acct()}/voices/${r.doc}`);
      const b64 = d && d.fields && val(d.fields.data);
      if (!b64) continue;
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      await VB.put(k, new Blob([bin], { type: 'audio/wav' }), r.by, r.at);
    }
  }

  // ---- えらんで どうき（うけいれる／こうしんする）----
  async function peek() {
    const doc = await req('GET', acct());
    const save = doc && doc.fields && val(doc.fields.save) ? JSON.parse(val(doc.fields.save)) : null;
    if (VB) await VB.ready;
    return { save, voices: VB ? await listVoices() : new Map() };
  }
  async function getVoice(r) {
    const d = await req('GET', `${acct()}/voices/${r.doc}`);
    const b64 = d && d.fields && val(d.fields.data);
    return b64 ? new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'audio/wav' }) : null;
  }
  // ⬇️ ウェブの データを この スマホに いれる（この スマホだけの ものは きえる）
  async function pull(remote) {
    if (remote.save) game.set(remote.save);
    if (!VB) return;
    const now = Date.now();
    for (const [k, m] of VB.meta()) {
      const r = remote.voices.get(k);
      if (!r || r.deleted) await VB.remove(k, now);
      else if (r.at !== m.at) {
        const b = await getVoice(r);
        if (b) await VB.put(k, b, r.by, r.at);
      }
    }
    const local = VB.meta();
    for (const [k, r] of remote.voices) {
      if (r.deleted || local.has(k)) continue;
      const b = await getVoice(r);
      if (b) await VB.put(k, b, r.by, r.at);
    }
  }
  // ⬆️ この スマホの データで ウェブを うわがき（ほかの スマホも つぎの どうきで これに なる）
  async function push(remote) {
    const now = Date.now();
    // resetAt を あたらしく すると、ほかの スマホは たしざん せずに これを うけとる
    const save = { ...game.get(), resetAt: now };
    game.set(save);
    await req('PATCH', acct(), { fields: { save: S(JSON.stringify(save)), updated: I(now) } });
    if (!VB) return;
    const local = VB.meta();
    for (const [k, m] of local) {
      const r = remote.voices.get(k);
      const b = await VB.blob(k);
      if (!b) continue;
      if (r && !r.deleted && r.at === m.at) {
        // おなじ こえは じかんだけ あたらしく
        await req('PATCH', `${acct()}/voices/${r.doc}`, { fields: { at: I(now) } }, '&updateMask.fieldPaths=at');
      } else {
        await req('PATCH', `${acct()}/voices/${await docId(k)}`, {
          fields: { key: S(k), by: S(m.by || ''), at: I(now), deleted: B(false), data: { bytesValue: await toBase64(b) } },
        });
      }
      await VB.put(k, b, m.by, now);
    }
    for (const [k, r] of remote.voices) {
      if (r.deleted || local.has(k)) continue;
      await req('PATCH', `${acct()}/voices/${r.doc}`, { fields: { key: S(k), by: S(''), at: I(now), deleted: B(true) } });
    }
  }
  function summary(save, voices) {
    if (!save) return 'まだ なにも ない';
    const medals = Object.values(save.caught || {}).filter(n => n > 0).length;
    return `${(save.cleared || []).length}だん クリア・メダル ${medals}こ・こえ ${voices}こ`;
  }
  const hasData = (save, voices) => !!save && ((save.cleared || []).length > 0 || Object.keys(save.caught || {}).length > 0 || voices > 0);

  // ---- どうき ----
  function setState(ok, msg) {
    state = { ok, at: ok ? Date.now() : state.at, msg };
    renderStatus();
  }
  function sync({ save = true, voices = true } = {}) {
    if (!configured || !id || !game || choosing) return Promise.resolve();
    if (busy) {
      busy.again = { save: busy.again.save || save, voices: busy.again.voices || voices };
      return busy.p;
    }
    const run = { again: { save: false, voices: false } };
    busy = run;
    setState(null, 'どうきちゅう…');
    run.p = (async () => {
      try {
        if (save) await syncSave();
        if (voices) await syncVoices();
        setState(true, '');
      } catch (e) {
        setState(false, navigator.onLine === false ? 'オフラインです。つながったら どうきするよ' : 'どうき できなかったよ');
      } finally {
        busy = null;
        if (run.again.save || run.again.voices) sync(run.again);
      }
    })();
    return run.p;
  }
  // いま うごいている どうきが おわってから、えらんだ ほうで どうき
  async function force(mode, remote) {
    while (busy) await busy.p;
    const run = { again: { save: false, voices: false } };
    busy = run;
    setState(null, 'どうきちゅう…');
    run.p = (async () => {
      try {
        const r = remote || await peek();
        await (mode === 'pull' ? pull(r) : push(r));
        setState(true, '');
      } catch (e) {
        setState(false, navigator.onLine === false ? 'オフラインです。つながってから もういちど えらんでね' : 'どうき できなかったよ');
      } finally {
        busy = null;
        if (run.again.save || run.again.voices) sync(run.again);
      }
    })();
    return run.p;
  }
  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const saveChanged = debounce(() => sync({ voices: false }), 1500);
  const voicesChanged = debounce(() => sync({ save: false }), 2500);
  if (VB) VB.onChange(k => { if (k) voicesChanged(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  window.addEventListener('online', () => sync());

  // ---- ID ----
  function normalize(s) {
    return s.trim().toLowerCase().replace(/[\s　]+/g, '-').replace(/[^a-z0-9-]/g, '');
  }
  function makeId() {
    const w = ['wani', 'ari', 'inu', 'neko', 'kani', 'tako', 'hoshi', 'momo', 'ringo', 'kuma'];
    const r = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
    return `${w[crypto.getRandomValues(new Uint8Array(1))[0] % w.length]}-${r(4)}-${r(4)}`;
  }
  async function connect(newId) {
    id = newId;
    try { localStorage.setItem(ID_KEY, id); } catch (e) { /* むし */ }
    await ask(true);
  }
  function disconnect() {
    id = '';
    choosing = null;
    try { localStorage.removeItem(ID_KEY); } catch (e) { /* むし */ }
    setState(null, '');
  }

  // ---- がめん ----
  const ov = $('#overlay-cloud');
  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? 'いま' : s < 3600 ? `${Math.floor(s / 60)}ぷん まえ` : `${Math.floor(s / 3600)}じかん まえ`;
  }
  function renderStatus() {
    const btn = $('#btn-cloud');
    if (btn) btn.textContent = id ? (state.ok === false ? '☁️ きょうゆう ⚠️' : '☁️ きょうゆう ✓') : '☁️ きょうゆう';
    if (!ov.classList.contains('show')) return;
    $('#cloud-setup').hidden = configured;
    $('#cloud-form').hidden = !configured || !!id;
    $('#cloud-linked').hidden = !configured || !id;
    $('#cloud-id-now').textContent = id;
    $('#cloud-choice').hidden = !choosing;
    $('#cloud-btns-linked').hidden = !!choosing;
    $('#cloud-state').textContent = state.ok === null && state.msg ? state.msg
      : state.ok === false ? `⚠️ ${state.msg}`
        : state.at ? `✅ ${ago(state.at)} どうき しました` : '';
  }
  function say(t) {
    $('#cloud-msg').textContent = t;
  }
  async function onConnect() {
    const v = normalize($('#cloud-id').value);
    $('#cloud-id').value = v;
    if (v.length < 8) return say('ID は 8もじ いじょう（えいすうじと -）に してね');
    say('');
    await connect(v);
    renderStatus();
  }

  // どっちの データに するか きく（first: つないだ ときは、かたほうに しか ない なら きかずに まぜる）
  async function ask(first) {
    say('ウェブの データを みています…');
    let remote;
    try {
      remote = await peek();
    } catch (e) {
      say('');
      setState(false, navigator.onLine === false ? 'オフラインです。つながったら どうきするよ' : 'ウェブの データが みられなかったよ');
      return;
    }
    const localSave = game.get();
    const localN = VB ? VB.meta().size : 0;
    const remoteN = [...remote.voices.values()].filter(r => !r.deleted).length;
    const a = summary(localSave, localN);
    const b = summary(remote.save, remoteN);
    if (first && (!hasData(localSave, localN) || !hasData(remote.save, remoteN) || a === b)) {
      say('');
      await sync();
      if (state.ok) say('つながったよ！ ほかの スマホでも この ID を いれてね');
      return;
    }
    choosing = { remote };
    $('#cloud-here').textContent = a;
    $('#cloud-web').textContent = b;
    say(first ? 'この ID には もう データが あるよ。どう する？' : 'どう どうき する？');
    renderStatus();
  }
  async function choose(mode) {
    const c = choosing;
    if (!c) return;
    if (mode === 'pull' && !confirm('この スマホの データを、ウェブの データに おきかえますか？\n（この スマホだけで すすめた ぶんは きえます）')) return;
    if (mode === 'push' && !confirm('ウェブの データを、この スマホの データで うわがき しますか？\n（ほかの スマホも つぎの どうきで この スマホと おなじに なります）')) return;
    choosing = null;
    renderStatus();
    say('');
    if (mode === 'merge') await sync();
    else await force(mode, c.remote);
    if (state.ok) say({ merge: 'まぜて どうき したよ', pull: 'ウェブの データを うけいれたよ', push: 'ウェブの データを こうしん したよ' }[mode]);
  }
  $('#cloud-merge').onclick = () => choose('merge');
  $('#cloud-pull').onclick = () => choose('pull');
  $('#cloud-push').onclick = () => choose('push');
  $('#cloud-cancel').onclick = () => { choosing = null; say(''); renderStatus(); };

  $('#cloud-new').onclick = () => { $('#cloud-id').value = makeId(); say('あたらしい ID を つくったよ。メモして おいてね'); };
  $('#cloud-connect').onclick = onConnect;
  $('#cloud-id').addEventListener('keydown', e => { if (e.key === 'Enter') onConnect(); });
  $('#cloud-sync').onclick = () => ask(false);
  $('#cloud-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(id); say('ID を コピーしたよ'); } catch (e) { say(id); }
  };
  $('#cloud-unlink').onclick = () => {
    if (confirm('この スマホの きょうゆうを やめますか？（ウェブの データは のこります）')) {
      disconnect();
      say('きょうゆうを やめたよ');
      renderStatus();
    }
  };
  $('#cloud-close').onclick = () => {
    ov.classList.remove('show');
    if (choosing) { choosing = null; sync(); }
  };
  $('#btn-cloud').onclick = () => {
    $('#cloud-id').value = '';
    say('');
    ov.classList.add('show');
    renderStatus();
  };

  return {
    configured,
    get id() { return id; },
    // game.js から よぶ: { get: () => save, set: s => ... }
    attach(g) {
      game = g;
      renderStatus();
      sync();
    },
    saveChanged() { if (id) saveChanged(); },
    sync,
    mergeSave,
  };
})();
