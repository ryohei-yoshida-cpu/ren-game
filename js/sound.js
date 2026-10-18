// おと と こえ（Web Audio + Web Speech）
window.Sound = (() => {
  let ctx = null;
  let jaVoice = null;
  const synth = window.speechSynthesis || null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function pickVoice() {
    if (!synth) return;
    const ja = synth.getVoices().filter(v => /^ja/i.test(v.lang));
    jaVoice = ja.find(v => /Kyoko|O-ren|Nanami|Google/i.test(v.name)) || ja[0] || null;
  }
  if (synth) {
    pickVoice();
    synth.onvoiceschanged = pickVoice;
  }

  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  function tone(freq, start, dur, { type = 'triangle', vol = 0.15, slide = 0 } = {}) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(start, dur, { vol = 0.15, freq = 1200 } = {}) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + start;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  }

  // ---- こえ ----
  // じぶんたちで とった こえ（VoiceBox）→ VOICEVOX で つくった こえ（audio/voice）→ ブラウザの よみあげ の じゅんに つかう
  //   who: kid（ひらがなの なかま）/ narr（ナレーション）/ hime（おひめさま）/ wani（ワニ）/ foe（わるもの）
  //   text の '|' で くぎると、つくった こえを つなげて ならす（ヒーローの なまえ など）
  const VOICE_DIR = 'audio/voice/';
  let voiceIndex = null;
  const clips = new Map();   // ファイル → AudioBuffer の Promise
  let queue = Promise.resolve();
  let gen = 0;
  let playing = null;

  fetch(VOICE_DIR + 'index.json')
    .then(r => r.json())
    .then(j => { voiceIndex = j; migrate(); })
    .catch(() => { /* こえが ない ときは よみあげで */ });

  // まえに「なかま（みんな）」で とった うたは その キャラへ、ヒーローの なまえなどは ナレーションへ うつす（いちどだけ）
  async function migrate() {
    const FLAG = 'voice-migrated-2';
    try { if (!window.VoiceBox || localStorage.getItem(FLAG)) return; } catch (e) { return; }
    await VB.ready;
    const meta = VB.meta();
    for (const k of VB.keys()) {
      if (!k.startsWith('kid|')) continue;
      const t = k.slice(4);
      const song = t.match(/^(.)、\1、/);
      const to = song ? `c:${song[1]}|${t}` : voiceIndex[`narr|${t}`] && !voiceIndex[`kid|${t}`] ? `narr|${t}` : null;
      if (!to || VB.recorded(to)) continue;
      const b = await VB.blob(k);
      const m = meta.get(k);
      await VB.put(to, b, m.by, m.at);
      await VB.remove(k);
    }
    try { localStorage.setItem(FLAG, '1'); } catch (e) { /* むし */ }
  }

  function decode(buf) {
    const c = ac();
    return new Promise((res, rej) => {
      const p = c.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }
  const VB = window.VoiceBox;
  if (VB) VB.onChange(k => { if (k) clips.delete('c:' + k); else clips.clear(); });

  // id は 'c:セリフ'（じぶんの こえ）か 'v:ファイル'（VOICEVOX）
  function clip(id) {
    if (!clips.has(id)) {
      const src = id.startsWith('c:')
        ? VB.blob(id.slice(2)).then(b => b.arrayBuffer())
        : fetch(VOICE_DIR + id.slice(2)).then(r => r.arrayBuffer());
      // じぶんの こえは ならす ときにも おおきさを そろえる（まえに とった こえ・もらった こえも）
      const p = src.then(decode).then(buf => {
        if (id.startsWith('c:')) buf.level = VB.loudnessGain(buf.getChannelData(0), 0, buf.length, buf.sampleRate);
        return buf;
      });
      p.catch(() => clips.delete(id));
      clips.set(id, p);
      // つかいおわった ものは すこしずつ わすれる（メモリ たいさく）
      if (clips.size > 60) clips.delete(clips.keys().next().value);
    }
    return clips.get(id);
  }
  // キャラ（who が 'c:い' など）の こえは、
  //   そのキャラの ろくおん → みんな（kid）の ろくおん → VOICEVOX の じゅんに さがす
  function clipId(who, text) {
    const base = who.startsWith('c:') ? 'kid' : who;
    for (const w of base === who ? [who] : [who, base]) {
      const k = `${w}|${text}`;
      if (VB && VB.has(k)) return 'c:' + k;
    }
    const f = voiceIndex && voiceIndex[`${base}|${text}`];
    return f ? 'v:' + f : null;
  }
  function playBuffer(buf) {
    return new Promise(res => {
      const c = ac();
      if (!c) return res();
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = buf.level || 1;
      src.connect(g).connect(c.destination);
      let done = false;
      const end = () => { if (!done) { done = true; if (playing === src) playing = null; res(); } };
      src.onended = end;
      setTimeout(end, buf.duration * 1000 + 400);   // おとが とまっていても さきに すすむ
      playing = src;
      src.start();
    });
  }

  function speak(text, { pitch = 1.2, rate = 1.0, volume = 1 } = {}) {
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    if (jaVoice) u.voice = jaVoice;
    u.pitch = pitch;
    u.rate = rate;
    u.volume = volume;
    synth.speak(u);
  }

  function say(text, opts = {}) {
    const who = opts.who || 'narr';
    const parts = text.split('|').map(t => t.trim());
    const files = parts.map(t => clipId(who, t));
    if (files.some(f => !f)) {
      speak(parts.join(' '), opts);
      return;
    }
    const my = gen;
    const loads = files.map(clip);   // すぐ よみこみ はじめる
    queue = queue.then(async () => {
      for (const l of loads) {
        if (my !== gen) return;
        let buf;
        try { buf = await l; } catch (e) { return; }
        if (my !== gen) return;
        await playBuffer(buf);
      }
    });
  }

  function hush() {
    gen++;
    queue = Promise.resolve();
    if (playing) {
      try { playing.stop(); } catch (e) { /* もう とまっている */ }
      playing = null;
    }
    if (synth) synth.cancel();
  }

  // こえを まえもって ダウンロードして おく（オフラインでも ならせるように）
  function preloadVoices() {
    if (!voiceIndex) return;
    const files = Object.entries(voiceIndex).filter(([k]) => k !== '_v').map(([, f]) => f);
    // VOICEVOX の こえだけ（じぶんの こえは もう たんまつに ある）
    let i = 0;
    const next = () => {
      if (i >= files.length) return;
      fetch(VOICE_DIR + files[i++]).catch(() => {}).finally(next);
    };
    for (let k = 0; k < 3; k++) next();
  }

  // さいしょの タップで おとを だせるように する（iPhone/iPad たいさく）
  let unlocked = false;
  function unlock() {
    ac();
    if (synth) speak(' ', { volume: 0 });
    if (!unlocked) {
      unlocked = true;
      setTimeout(preloadVoices, 3000);
    }
  }

  // 「い、い、いぬの い♪」
  // ひらがなごとに すこし キーを かえて あきないように
  function sing(char, word) {
    const beat = 0.42;
    const key = [0, 2, 4, 5, 7, -3][char.charCodeAt(0) % 6];
    const n = x => midi(x + key);
    // メロディ
    tone(n(72), 0, beat * 0.8, { type: 'square', vol: 0.03 });
    tone(n(72), beat, beat * 0.8, { type: 'square', vol: 0.03 });
    tone(n(76), beat * 2, beat * 0.45, { type: 'square', vol: 0.03 });
    tone(n(76), beat * 2.5, beat * 0.45, { type: 'square', vol: 0.03 });
    tone(n(74), beat * 3, beat * 0.8, { type: 'square', vol: 0.03 });
    tone(n(79), beat * 4, beat * 1.6, { type: 'square', vol: 0.035 });
    tone(n(76), beat * 4, beat * 1.6, { type: 'triangle', vol: 0.08 });
    tone(n(72), beat * 4, beat * 1.6, { type: 'triangle', vol: 0.08 });
    // ベース と てびょうし
    for (let i = 0; i < 5; i++) {
      tone(n(i % 2 ? 55 : 48), beat * i, beat * 0.5, { type: 'sine', vol: 0.18 });
      if (i % 2) noise(beat * i, 0.08, { vol: 0.25, freq: 2500 });
    }
    // うた
    hush();
    say(`${char}、${char}、${word}の ${char}！`, { who: 'c:' + char, pitch: 1.4 });
    return (beat * 5.5) * 1000;
  }

  return {
    unlock,
    say,
    hush,
    voiceIndex: () => voiceIndex,
    sing,
    pop() { tone(500, 0, 0.15, { type: 'sine', vol: 0.25, slide: 2.2 }); },
    hop() { tone(350, 0, 0.18, { type: 'triangle', vol: 0.12, slide: 1.8 }); },
    whoosh() { noise(0, 0.35, { vol: 0.2, freq: 900 }); },
    blip(t) { tone(500 + t * 600, 0, 0.06, { type: 'sine', vol: 0.05 }); },
    chime(i) {
      const base = 76 + (i % 3) * 2;
      tone(midi(base), 0, 0.25, { type: 'sine', vol: 0.2 });
      tone(midi(base + 7), 0.08, 0.35, { type: 'sine', vol: 0.18 });
    },
    bonk() {
      tone(220, 0, 0.3, { type: 'square', vol: 0.12, slide: 0.4 });
      noise(0, 0.15, { vol: 0.4, freq: 400 });
      tone(1500, 0.05, 0.12, { type: 'sine', vol: 0.08 });
      tone(1900, 0.12, 0.12, { type: 'sine', vol: 0.08 });
    },
    caught() {
      [72, 76, 79, 84].forEach((m, i) => tone(midi(m), i * 0.09, 0.3, { type: 'triangle', vol: 0.16 }));
    },
    // ---- ヒーロー ----
    henshin() {
      tone(200, 0, 0.9, { type: 'square', vol: 0.06, slide: 8 });
      noise(0, 0.9, { vol: 0.15, freq: 3000 });
      [72, 76, 79, 84, 88, 91].forEach((m, i) => tone(midi(m), 0.5 + i * 0.06, 0.25, { type: 'triangle', vol: 0.12 }));
    },
    clank() {
      tone(900, 0, 0.12, { type: 'square', vol: 0.08, slide: 0.7 });
      noise(0, 0.1, { vol: 0.35, freq: 5000 });
      tone(1400, 0.05, 0.3, { type: 'sine', vol: 0.1 });
    },
    jet() {
      noise(0, 0.9, { vol: 0.3, freq: 500 });
      tone(90, 0, 0.9, { type: 'sawtooth', vol: 0.05, slide: 1.8 });
    },
    sword() {
      noise(0, 0.12, { vol: 0.3, freq: 6000 });
      tone(2400, 0.02, 0.6, { type: 'sine', vol: 0.08 });
      tone(3300, 0.04, 0.5, { type: 'sine', vol: 0.06 });
    },
    slash() {
      noise(0, 0.22, { vol: 0.45, freq: 2500 });
      tone(1200, 0, 0.2, { type: 'triangle', vol: 0.1, slide: 0.25 });
      tone(2600, 0.2, 0.4, { type: 'sine', vol: 0.06 });
    },
    saber() {
      tone(110, 0, 0.8, { type: 'sawtooth', vol: 0.07, slide: 1.4 });
      tone(220, 0, 0.5, { type: 'sine', vol: 0.1, slide: 2 });
      noise(0, 0.3, { vol: 0.15, freq: 1500 });
    },
    laser() {
      tone(1600, 0.15, 0.25, { type: 'square', vol: 0.08, slide: 0.12 });
      tone(1600, 0.3, 0.25, { type: 'square', vol: 0.06, slide: 0.12 });
      noise(0.15, 0.1, { vol: 0.2, freq: 4000 });
    },
    twirl() {
      [600, 800, 1000, 1200, 1400].forEach((f, i) => tone(f, i * 0.06, 0.08, { type: 'sine', vol: 0.08 }));
      [72, 79, 84].forEach(m => tone(midi(m), 0.4, 0.4, { type: 'triangle', vol: 0.1 }));
    },
    // ---- たたかい ----
    push(t) {
      tone(260 + t * 500, 0, 0.08, { type: 'square', vol: 0.07 });
      noise(0, 0.05, { vol: 0.2, freq: 1800 });
    },
    charge() {
      tone(150, 0, 1.0, { type: 'sawtooth', vol: 0.06, slide: 6 });
      tone(300, 0.1, 0.9, { type: 'sine', vol: 0.08, slide: 4 });
    },
    boom() {
      noise(0, 0.7, { vol: 0.6, freq: 300 });
      tone(140, 0, 0.6, { type: 'square', vol: 0.12, slide: 0.25 });
      [84, 88, 91].forEach((m, i) => tone(midi(m), 0.35 + i * 0.08, 0.3, { type: 'triangle', vol: 0.1 }));
    },
    // ---- おはなし ----
    door() {
      tone(90, 0, 0.35, { type: 'square', vol: 0.12, slide: 0.6 });
      noise(0, 0.25, { vol: 0.4, freq: 250 });
    },
    rumble() {
      noise(0, 1.2, { vol: 0.35, freq: 120 });
      tone(55, 0, 1.2, { type: 'sawtooth', vol: 0.06 });
    },
    kiss() {
      tone(900, 0, 0.12, { type: 'sine', vol: 0.15, slide: 1.8 });
      [84, 88, 91, 96].forEach((m, i) => tone(midi(m), 0.15 + i * 0.07, 0.4, { type: 'triangle', vol: 0.08 }));
    },
    // ---- メダル ----
    medal() {
      tone(988, 0, 0.1, { type: 'square', vol: 0.07 });
      tone(1319, 0.09, 0.45, { type: 'square', vol: 0.07 });
    },
    medalUp() {
      [72, 76, 79, 84, 88, 91, 96].forEach((m, i) => tone(midi(m), i * 0.05, 0.3, { type: 'triangle', vol: 0.1 }));
      noise(0, 0.5, { vol: 0.1, freq: 7000 });
    },
    fanfare() {
      const seq = [[67, 0], [72, 0.15], [76, 0.3], [79, 0.45], [76, 0.65], [79, 0.8]];
      seq.forEach(([m, t]) => tone(midi(m), t, 0.25, { type: 'square', vol: 0.07 }));
      [72, 76, 79, 84].forEach(m => tone(midi(m), 1.0, 1.2, { type: 'triangle', vol: 0.1 }));
    },
  };
})();
