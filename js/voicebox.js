// じぶんたちで とった こえ
//   ・セリフ（"who|text"）ごとに、たんまつの なか（IndexedDB）に ほぞん
//   ・ろくおんは まえと うしろの しずかな ところを けずって、16kHz の WAV に する
//   ・「こえパック」ファイルに まとめて LINE などで おくったり、よみこんだり できる
window.VoiceBox = (() => {
  const DB = 'hiragana-voices';
  const STORE = 'clips';
  const RATE = 16000;
  const PACK = 'hiragana-matemate-voices';
  const keys = new Map();    // key → { by: だれが とったか, at: いつ }
  const TOMBS = 'voice-tombstones';   // けした こえ（ほかの スマホにも けしたことを つたえる）
  const listeners = [];
  let dbp = null;

  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    }));
  }

  const ready = tx('readonly', s => s.getAll())
    .then(all => tx('readonly', s => s.getAllKeys()).then(ks => ks.forEach((k, i) => keys.set(k, { by: all[i].by || '', at: all[i].at || 0 }))))
    .catch(() => { /* つかえない ブラウザ */ });

  function tombs() {
    try { return JSON.parse(localStorage.getItem(TOMBS)) || {}; } catch (e) { return {}; }
  }
  function setTomb(key, at) {
    const t = tombs();
    if (at) t[key] = at; else delete t[key];
    try { localStorage.setItem(TOMBS, JSON.stringify(t)); } catch (e) { /* むし */ }
  }

  function changed(key) {
    listeners.forEach(f => f(key));
  }

  let enabled = true;
  try { enabled = localStorage.getItem('voicebox-off') !== '1'; } catch (e) { /* むし */ }

  async function put(key, blob, by, at = Date.now()) {
    await tx('readwrite', s => s.put({ blob, by, at }, key));
    keys.set(key, { by, at });
    setTomb(key, 0);
    changed(key);
  }
  async function remove(key, at = Date.now()) {
    await tx('readwrite', s => s.delete(key));
    keys.delete(key);
    setTomb(key, at);
    changed(key);
  }
  async function blob(key) {
    const r = await tx('readonly', s => s.get(key));
    return r && r.blob;
  }

  // ---- ろくおん ----
  function encodeWav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const x = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, x * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // こえの きこえかたの おおきさを、VOICEVOX の こえ（しゃべって いる ところの へいきん -25dB くらい）に そろえる
  const TARGET_RMS = Math.pow(10, -24 / 20);
  const PEAK_LIMIT = Math.pow(10, -3 / 20);
  function loudnessGain(d, from = 0, to = d.length, sr = 16000) {
    const win = Math.max(1, Math.floor(sr * 0.01));
    const frames = [];
    let peak = 0;
    for (let i = from; i + win <= to; i += win) {
      let sum = 0;
      for (let j = i; j < i + win; j++) {
        sum += d[j] * d[j];
        peak = Math.max(peak, Math.abs(d[j]));
      }
      frames.push(sum / win);
    }
    if (!frames.length || peak < 1e-4) return 1;
    const th = Math.max(...frames) * 0.01;   // しゃべって いる ところだけ はかる
    const act = frames.filter(f => f > th);
    const rms = Math.sqrt(act.reduce((a, b) => a + b, 0) / act.length);
    return Math.min(TARGET_RMS / rms, PEAK_LIMIT / peak, 8);
  }

  // まえと うしろの しずかな ところを けずり、おとの おおきさを そろえる
  async function tidy(raw) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const audio = await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(raw, res, rej);
      if (p && p.then) p.then(res, rej);
    });
    ctx.close && ctx.close();
    const d = audio.getChannelData(0);
    const sr = audio.sampleRate;
    const win = Math.floor(sr * 0.01);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak < 0.01) throw new Error('quiet');
    const th = Math.max(0.015, peak * 0.08);
    let first = -1, last = -1;
    for (let i = 0; i + win <= d.length; i += win) {
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += d[j] * d[j];
      if (Math.sqrt(sum / win) > th) {
        if (first < 0) first = i;
        last = i + win;
      }
    }
    if (first < 0) throw new Error('quiet');
    const start = Math.max(0, first - Math.floor(sr * 0.06));
    const end = Math.min(d.length, last + Math.floor(sr * 0.15));
    const len = Math.ceil((end - start) / sr * RATE);
    const off = new OfflineAudioContext(1, len, RATE);
    const src = off.createBufferSource();
    src.buffer = audio;
    const g = off.createGain();
    g.gain.value = loudnessGain(d, start, end, sr);
    src.connect(g).connect(off.destination);
    src.start(0, start / sr, (end - start) / sr);
    const out = await off.startRendering();
    return encodeWav(out.getChannelData(0), RATE);
  }

  // ろくおんを はじめる。かえりちの stop() で WAV の Blob が もらえる
  async function record(maxSeconds = 12) {
    if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('unsupported');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });
    rec.start();
    const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), maxSeconds * 1000);
    const end = () => {
      clearTimeout(timer);
      if (rec.state === 'recording') rec.stop();
      stream.getTracks().forEach(t => t.stop());
    };
    return {
      stopped,
      async stop() {
        end();
        await stopped;
        const raw = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer();
        return tidy(raw);
      },
      cancel: end,
    };
  }

  // ---- こえパック ----
  const toBase64 = b => new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.readAsDataURL(b);
  });
  // こえパックは PDF に する（LINE で ファイルとして ちゃんと おくれる ように）。
  // ひらくと せつめいの ページが みえて、こえの データは PDF の なかに かくして いれる
  const BEGIN = '%HMVPACK-BEGIN\n', END = '\n%HMVPACK-END';

  function coverJpeg(by, lines) {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 800;
    const g = c.getContext('2d');
    g.fillStyle = '#fff4dc'; g.fillRect(0, 0, 600, 800);
    g.fillStyle = '#ff6b6b'; g.font = '900 44px sans-serif'; g.textAlign = 'center';
    g.fillText('🎙 こえパック', 300, 100);
    g.fillStyle = '#4a3426'; g.font = '700 28px sans-serif';
    g.fillText('わるいワニをやっつけろ', 300, 160);
    g.fillText('「ひらがなまてまて」', 300, 200);
    g.font = '900 34px sans-serif';
    g.fillText(`${by || 'ともだち'} の こえ ${lines.length}こ`, 300, 280);
    g.font = '700 22px sans-serif'; g.textAlign = 'left';
    lines.slice(0, 12).forEach((t, i) => g.fillText('・' + t.slice(t.indexOf('|') + 1).slice(0, 22), 50, 340 + i * 30));
    if (lines.length > 12) g.fillText(`… ほか ${lines.length - 12}こ`, 50, 340 + 12 * 30);
    g.fillStyle = '#c2410c'; g.font = '700 22px sans-serif'; g.textAlign = 'center';
    g.fillText('ゲームの「🎙 こえ」→「📥 こえを よみこむ」で', 300, 740);
    g.fillText('この ファイルを えらんでね', 300, 772);
    const bin = atob(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    return { w: 600, h: 800, bytes: Uint8Array.from(bin, ch => ch.charCodeAt(0)) };
  }

  function buildPdf(img, data) {
    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let size = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
    const obj = (n, head, stream) => {
      offsets[n] = size;
      if (stream) {
        push(`${n} 0 obj\n<< ${head} /Length ${stream.length} >>\nstream\n`);
        push(stream);
        push('\nendstream\nendobj\n');
      } else {
        push(`${n} 0 obj\n${head}\nendobj\n`);
      }
    };
    const W = 595, H = Math.round(595 * img.h / img.w);
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>`);
    obj(4, '', enc.encode(`q ${W} 0 0 ${H} 0 0 cm /Im1 Do Q`));
    obj(5, `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, img.bytes);
    obj(6, '', enc.encode(BEGIN + data + END));   // こえの データ（どこからも つかわれない オブジェクト）
    const xref = size;
    let x = 'xref\n0 7\n0000000000 65535 f \n';
    for (let i = 1; i <= 6; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function exportPack(list, by) {
    const clips = {};
    for (const k of list) {
      const b = await blob(k);
      if (b) clips[k] = await toBase64(b);
    }
    const n = Object.keys(clips).length;
    const body = JSON.stringify({ format: PACK, v: 1, by, at: new Date().toISOString(), clips });
    const pdf = buildPdf(coverJpeg(by, Object.keys(clips)), body);
    const safe = (by || 'なまえなし').replace(/[\\/:*?"<>|\s]/g, '');
    return { file: new File([pdf], `こえパック_${safe}_${n}こ.pdf`, { type: 'application/pdf' }), count: n };
  }

  // こえパックを よむ（まだ いれない）→ { by, clips: [{ key, blob }] }
  async function readPack(file) {
    const text = new TextDecoder().decode(await file.arrayBuffer());
    let json = text.trim();
    const a = text.indexOf(BEGIN);
    if (a >= 0) json = text.slice(a + BEGIN.length, text.indexOf(END, a));   // PDF の こえパック
    const j = JSON.parse(json);                                              // まえの .txt も よめる
    if (j.format !== PACK || !j.clips) throw new Error('format');
    const clips = Object.entries(j.clips).map(([key, b64]) => ({
      key, blob: new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'audio/wav' }),
    }));
    return { by: j.by || '', clips };
  }

  return {
    ready,
    has: k => enabled && keys.has(k),
    recorded: k => keys.has(k),
    by: k => (keys.get(k) || {}).by,
    keys: () => [...keys.keys()],
    meta: () => new Map(keys),
    loudnessGain,
    tombstones: tombs,
    blob, put, remove, record, exportPack, readPack,
    onChange: f => listeners.push(f),
    get enabled() { return enabled; },
    set enabled(on) {
      enabled = on;
      try { localStorage.setItem('voicebox-off', on ? '0' : '1'); } catch (e) { /* むし */ }
      changed(null);
    },
  };
})();
