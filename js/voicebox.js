// じぶんたちで とった こえ
//   ・セリフ（"who|text"）ごとに、たんまつの なか（IndexedDB）に ほぞん
//   ・ろくおんは まえと うしろの しずかな ところを けずって、16kHz の WAV に する
//   ・「こえパック」ファイルに まとめて LINE などで おくったり、よみこんだり できる
window.VoiceBox = (() => {
  const DB = 'hiragana-voices';
  const STORE = 'clips';
  const RATE = 16000;
  const PACK = 'hiragana-matemate-voices';
  const keys = new Map();    // key → だれが とったか
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
    .then(all => tx('readonly', s => s.getAllKeys()).then(ks => ks.forEach((k, i) => keys.set(k, all[i].by || ''))))
    .catch(() => { /* つかえない ブラウザ */ });

  function changed(key) {
    listeners.forEach(f => f(key));
  }

  let enabled = true;
  try { enabled = localStorage.getItem('voicebox-off') !== '1'; } catch (e) { /* むし */ }

  async function put(key, blob, by) {
    await tx('readwrite', s => s.put({ blob, by, at: Date.now() }, key));
    keys.set(key, by);
    changed(key);
  }
  async function remove(key) {
    await tx('readwrite', s => s.delete(key));
    keys.delete(key);
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
    g.gain.value = 0.9 / peak;
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
  async function exportPack(list, by) {
    const clips = {};
    for (const k of list) {
      const b = await blob(k);
      if (b) clips[k] = await toBase64(b);
    }
    const n = Object.keys(clips).length;
    const body = JSON.stringify({ format: PACK, v: 1, by, at: new Date().toISOString(), clips });
    const safe = (by || 'なまえなし').replace(/[\\/:*?"<>|\s]/g, '');
    return { file: new File([body], `こえパック_${safe}_${n}こ.txt`, { type: 'text/plain' }), count: n };
  }
  async function importPack(file) {
    const j = JSON.parse(await file.text());
    if (j.format !== PACK || !j.clips) throw new Error('format');
    let n = 0;
    for (const [k, b64] of Object.entries(j.clips)) {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      await put(k, new Blob([bin], { type: 'audio/wav' }), j.by || '');
      n++;
    }
    return { count: n, by: j.by || '' };
  }

  return {
    ready,
    has: k => enabled && keys.has(k),
    recorded: k => keys.has(k),
    by: k => keys.get(k),
    keys: () => [...keys.keys()],
    blob, put, remove, record, exportPack, importPack,
    onChange: f => listeners.push(f),
    get enabled() { return enabled; },
    set enabled(on) {
      enabled = on;
      try { localStorage.setItem('voicebox-off', on ? '0' : '1'); } catch (e) { /* むし */ }
      changed(null);
    },
  };
})();
