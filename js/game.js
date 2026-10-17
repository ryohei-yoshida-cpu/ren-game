(() => {
  'use strict';

  const VB = 109; // KanjiVG の viewBox
  const SAVE_KEY = 'hiragana-oikakekko-v1';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = s => document.querySelector(s);
  const { WORDS, STAGES, STROKES, Sound } = window;

  // ---------- セーブ ----------
  function defaultSave() {
    return { unlocked: 0, cleared: [], caught: {}, mode: 'order' };
  }
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s === 'object') return Object.assign(defaultSave(), s);
    } catch (e) { /* つかえない ときは あたらしく */ }
    return defaultSave();
  }
  function writeSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* むし */ }
  }
  let save = loadSave();
  let caughtToday = [];

  // ---------- キャンセルできる まち ----------
  // ホームに もどったら epoch を すすめて、うごいている えんしゅつを ぜんぶ とめる
  let epoch = 0;
  let cleanups = [];
  const CANCEL = Symbol('cancel');

  function cancelAll() {
    epoch++;
    cleanups.forEach(f => f());
    cleanups = [];
    Sound.hush();
  }
  function sleep(ms) {
    const my = epoch;
    return new Promise((res, rej) => setTimeout(() => (my === epoch ? res() : rej(CANCEL)), ms));
  }
  const easeInOut = t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOutBack = t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  const easeIn = t => t * t;
  const linear = t => t;
  function tween(ms, fn, ease = easeInOut) {
    const my = epoch;
    return new Promise((res, rej) => {
      const t0 = performance.now();
      function frame(now) {
        if (my !== epoch) return rej(CANCEL);
        const t = Math.min(1, (now - t0) / ms);
        fn(ease(t));
        if (t < 1) requestAnimationFrame(frame); else res();
      }
      requestAnimationFrame(frame);
    });
  }
  function ignoreCancel(e) {
    if (e !== CANCEL) console.error(e);
  }

  // ---------- がめん ----------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }
  function showOverlay(id, on) {
    $(id).classList.toggle('show', on);
  }

  // ---------- キャラクター ----------
  class Actor {
    constructor(c) {
      this.c = c;
      this.info = WORDS[c];
      const el = document.createElement('div');
      el.className = 'actor';
      el.innerHTML =
        `<div class="body"><span class="emoji">${this.info.emoji}</span></div>` +
        `<span class="badge">${c}</span><div class="bubble"></div>`;
      $('#actors').appendChild(el);
      this.el = el;
      this.body = el.querySelector('.body');
      this.bubbleEl = el.querySelector('.bubble');
      this.x = VB / 2;
      this.y = VB / 2;
      this.size = 30;
      this.apply();
    }
    apply() {
      this.el.style.left = (this.x / VB * 100) + '%';
      this.el.style.top = (this.y / VB * 100) + '%';
      this.el.style.setProperty('--s', this.size);
    }
    face(dx) {
      if (Math.abs(dx) > 0.2) this.body.classList.toggle('flip', dx > 0);
    }
    set(x, y, size = this.size) {
      this.face(x - this.x);
      this.x = x; this.y = y; this.size = size;
      this.apply();
    }
    mode(cls) {
      this.el.classList.remove('idle', 'running', 'wiggle', 'happy');
      if (cls) this.el.classList.add(cls);
    }
    once(cls) {
      this.body.style.animation = 'none';
      this.el.classList.remove(cls);
      void this.el.offsetWidth;
      this.body.style.animation = '';
      this.el.classList.add(cls);
      setTimeout(() => this.el.classList.remove(cls), 800);
    }
    say(text, ms = 1800) {
      this.bubbleEl.textContent = text;
      this.bubbleEl.classList.add('show');
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = setTimeout(() => this.bubbleEl.classList.remove('show'), ms);
    }
    remove() { this.el.remove(); }
  }

  async function moveTo(actor, x, y, ms, { size = actor.size, arc = 0, ease = easeInOut } = {}) {
    const x0 = actor.x, y0 = actor.y, s0 = actor.size;
    actor.face(x - x0);
    await tween(ms, t => {
      actor.x = x0 + (x - x0) * t;
      actor.y = y0 + (y - y0) * t - Math.sin(Math.PI * t) * arc;
      actor.size = s0 + (size - s0) * t;
      actor.apply();
    }, ease);
  }

  function sparks(x, y, n = 8, chars = ['⭐', '✨', '💫']) {
    const fx = $('#fx');
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.textContent = chars[i % chars.length];
      const a = (Math.PI * 2 * i) / n + Math.random() * .4;
      const d = 50 + Math.random() * 40;
      s.style.left = (x / VB * 100) + '%';
      s.style.top = (y / VB * 100) + '%';
      s.style.setProperty('--dx', Math.cos(a) * d + 'px');
      s.style.setProperty('--dy', Math.sin(a) * d + 'px');
      fx.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
  }

  function setMessage(text) {
    const m = $('#message');
    m.textContent = text;
    m.classList.remove('show');
    void m.offsetWidth;
    m.classList.add('show');
  }

  // ---------- ボード ----------
  const board = $('#board');
  const svg = $('#svg');
  const gGuide = $('#g-guide'), gDemo = $('#g-demo'), gInk = $('#g-ink'), gNum = $('#g-num'), gHint = $('#g-hint');

  function resizeBoard() {
    board.style.setProperty('--bw', board.clientWidth + 'px');
  }
  window.addEventListener('resize', resizeBoard);

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function clearLetter() {
    [gGuide, gDemo, gInk, gNum, gHint].forEach(g => (g.innerHTML = ''));
    svg.classList.remove('fade');
  }

  // ひらがなの みち（かきじゅんの せん）を つくる
  function buildLetter(c, color) {
    clearLetter();
    return STROKES[c].map((d, i) => {
      gGuide.appendChild(svgEl('path', { d, class: 'road' }));
      const demo = svgEl('path', { d, class: 'demo' });
      const ink = svgEl('path', { d, class: 'ink', stroke: color });
      gDemo.appendChild(demo);
      gInk.appendChild(ink);
      const len = ink.getTotalLength();
      ink.style.strokeDasharray = `${len} ${len}`;
      ink.style.strokeDashoffset = len;
      demo.style.opacity = 0;
      const pts = [];
      for (let s = 0; s < len; s += 1) {
        const p = ink.getPointAtLength(s);
        pts.push({ x: p.x, y: p.y });
      }
      const end = ink.getPointAtLength(len);
      pts.push({ x: end.x, y: end.y });
      return { d, len, pts, ink, demo, index: i };
    });
  }

  function addNumbers(letter) {
    letter.forEach((s, i) => {
      // かきはじめの すこし てまえに おく。ちいさい もじは にじむので、おおきく かいて ちぢめる
      const a = s.pts[0], b = s.pts[Math.min(s.pts.length - 1, 4)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const p = { x: a.x - (b.x - a.x) / l * 8, y: a.y - (b.y - a.y) / l * 8 };
      const g = svgEl('g', { class: 'num', transform: `translate(${p.x} ${p.y}) scale(0.1)` });
      g.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 36 }));
      const t = svgEl('text', { x: 0, y: 2 });
      t.textContent = i + 1;
      g.appendChild(t);
      gNum.appendChild(g);
    });
  }

  function toSvg(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // ボードの そと（がめんの はし）の x
  function offscreenX(side) {
    const wrap = $('#board-wrap');
    const bw = board.clientWidth;
    const left = board.getBoundingClientRect().left - wrap.getBoundingClientRect().left;
    if (side < 0) return -(left / bw) * VB - 25;
    return ((wrap.clientWidth - left) / bw) * VB + 25;
  }

  // ---------- タップを まつ ----------
  function waitTap() {
    return new Promise((resolve, reject) => {
      const on = () => { off(); resolve(); };
      const off = () => board.removeEventListener('pointerdown', on);
      board.addEventListener('pointerdown', on);
      cleanups.push(() => { off(); reject(CANCEL); });
    });
  }

  // ---------- なぞる（にげる キャラを おいかける）----------
  function trace(letter, actor) {
    return new Promise((resolve, reject) => {
      const R = 14;      // ゆびが みちに ちかいと みなす はんけい
      const LOOK = 22;   // いちどに すすめる さいだい
      const AHEAD = 11;  // キャラは ゆびの すこし さきを にげる
      let si = 0, idx = 0, active = false, busy = false, lastBlip = 0;
      let lastProgress = performance.now();
      const ring = svgEl('circle', { r: 6, class: 'ring' });
      gHint.appendChild(ring);

      const cur = () => letter[si];
      function placeRing() {
        const p = cur().pts[idx];
        ring.setAttribute('cx', p.x);
        ring.setAttribute('cy', p.y);
      }
      function placeActor() {
        const s = cur();
        const j = Math.min(s.pts.length - 1, idx + AHEAD);
        const p = s.pts[j];
        const q = s.pts[Math.min(s.pts.length - 1, j + 3)];
        actor.set(p.x, p.y);
        actor.face(q.x - p.x);
      }
      function render() {
        const s = cur();
        s.ink.style.strokeDashoffset = Math.max(0, s.len - idx);
        placeRing();
        placeActor();
      }

      async function nextStroke() {
        busy = true;
        const s = cur();
        s.ink.style.strokeDashoffset = 0;
        Sound.chime(si);
        sparks(s.pts[s.pts.length - 1].x, s.pts[s.pts.length - 1].y, 5);
        si++;
        if (si >= letter.length) {
          finish();
          resolve();
          return;
        }
        idx = 0;
        lastBlip = 0;
        ring.style.display = 'none';
        const n = cur();
        const j = Math.min(n.pts.length - 1, AHEAD);
        Sound.hop();
        actor.mode(null);
        try {
          await moveTo(actor, n.pts[j].x, n.pts[j].y, 450, { arc: 12 });
        } catch (e) { return; }
        actor.mode('wiggle');
        ring.style.display = '';
        placeRing();
        lastProgress = performance.now();
        busy = false;
      }

      function handlePoint(e) {
        const pt = toSvg(e);
        const s = cur();
        let best = -1;
        const end = Math.min(s.pts.length - 1, idx + LOOK);
        for (let i = idx; i <= end; i++) {
          const p = s.pts[i];
          if ((p.x - pt.x) ** 2 + (p.y - pt.y) ** 2 < R * R) best = i;
        }
        if (best > idx) {
          idx = best;
          lastProgress = performance.now();
          render();
          if (idx - lastBlip > 7) {
            Sound.blip(idx / s.len);
            lastBlip = idx;
          }
        }
        if (idx >= s.pts.length - 3) nextStroke();
      }

      function onDown(e) {
        if (busy) return;
        active = true;
        actor.mode('running');
        try { board.setPointerCapture(e.pointerId); } catch (_) { /* なくても よい */ }
        handlePoint(e);
      }
      function onMove(e) {
        if (!active || busy) return;
        const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        if (list.length) {
          for (const ce of list) { if (!busy) handlePoint(ce); }
        } else {
          handlePoint(e);
        }
      }
      function onUp() {
        active = false;
        if (!busy) actor.mode('wiggle');
      }

      // しばらく うごかないと キャラが よびかける
      const hintTimer = setInterval(() => {
        if (busy || active) return;
        if (performance.now() - lastProgress > 6000) {
          actor.say(idx === 0 ? 'ここから おいかけて！' : 'こっちだよー！', 2000);
          lastProgress = performance.now();
        }
      }, 1000);

      function finish() {
        clearInterval(hintTimer);
        board.removeEventListener('pointerdown', onDown);
        board.removeEventListener('pointermove', onMove);
        board.removeEventListener('pointerup', onUp);
        board.removeEventListener('pointercancel', onUp);
        ring.remove();
      }

      board.addEventListener('pointerdown', onDown);
      board.addEventListener('pointermove', onMove);
      board.addEventListener('pointerup', onUp);
      board.addEventListener('pointercancel', onUp);
      cleanups.push(() => { finish(); reject(CANCEL); });

      actor.mode('wiggle');
      placeRing();
    });
  }

  // ---------- ひらがな ひとつぶん ----------
  async function playLetter(c, color, actor) {
    const info = WORDS[c];
    actor.mode('idle');
    setMessage(`${info.emoji} を タップしてね！`);
    await waitTap();

    // タップ → うたいながら にげる
    Sound.pop();
    actor.once('popin');
    actor.mode('happy');
    const song = `${c}、${c}、${info.word}の ${c}♪`;
    actor.say(song, 2600);
    setMessage(song);
    Sound.sing(c, info.word);
    await sleep(500);

    const letter = buildLetter(c, color);
    addNumbers(letter);
    const DEMO_SIZE = 15;

    // かきじゅんどおりに にげていく（おてほん）
    actor.mode('running');
    Sound.whoosh();
    for (const s of letter) {
      await moveTo(actor, s.pts[0].x, s.pts[0].y, 500, { size: DEMO_SIZE, arc: 14 });
      // はしった あとに せんが のこる（おわったら てんせんに もどす）
      s.demo.style.opacity = 1;
      const dur = Math.max(450, s.len * 12);
      await tween(dur, t => {
        const k = Math.min(s.pts.length - 1, Math.round(t * (s.pts.length - 1)));
        const p = s.pts[k];
        const q = s.pts[Math.min(s.pts.length - 1, k + 2)];
        actor.x = p.x; actor.y = p.y; actor.apply();
        actor.face(q.x - p.x);
        s.demo.style.strokeDasharray = `${t * s.len} ${s.len}`;
      }, linear);
      s.demo.style.strokeDasharray = '';
    }

    // さいしょの かくの ところで まつ
    const first = letter[0];
    const j = Math.min(first.pts.length - 1, 11);
    await moveTo(actor, first.pts[j].x, first.pts[j].y, 600, { arc: 16 });
    actor.mode('wiggle');
    actor.say('つかまえてごらん！', 2000);
    setMessage('ゆびで おいかけて なぞってね！');

    await trace(letter, actor);

    // つかまえた！
    Sound.caught();
    actor.mode('happy');
    setMessage('つかまえた！ じょうず！');
    sparks(VB / 2, VB / 2, 12);
    await moveTo(actor, VB * 0.78, VB * 0.78, 500, { size: 24, arc: 10, ease: easeOutBack });
    actor.say(`${c}！`, 1500);
    Sound.sing(c, info.word);
    markCaught(c);
    await sleep(2400);
  }

  // ---------- ごっつんこ して こうたい ----------
  async function swapActors(oldA, c) {
    svg.classList.add('fade');
    const newA = new Actor(c);
    const size = 30;
    const y = VB / 2;
    newA.set(offscreenX(1), y, size);
    newA.mode('running');
    oldA.mode('running');
    Sound.whoosh();

    // まんなかに むかって はしる
    const half = size / 2 - 2;
    await Promise.all([
      moveTo(oldA, VB / 2 - half, y, 900, { size, ease: easeIn }),
      moveTo(newA, VB / 2 + half, y, 900, { size, ease: easeIn }),
    ]);

    // ごっつんこ！
    Sound.bonk();
    clearLetter();
    oldA.mode(null); newA.mode(null);
    oldA.once('bonk'); newA.once('bonk');
    sparks(VB / 2, y - 12, 7, ['⭐', '💥', '✨']);
    await Promise.all([
      moveTo(oldA, VB / 2 - half - 10, y, 300, { ease: easeOutBack }),
      moveTo(newA, VB / 2 + half + 10, y, 300, { ease: easeOutBack }),
    ]);
    oldA.say('いててー！', 1600);
    Sound.say('いててー', { pitch: 1.2, rate: 1.0 });
    await sleep(650);
    newA.say('いててー！', 1600);
    Sound.say('いててー', { pitch: 1.9, rate: 1.1 });
    await sleep(1100);

    // こうたい
    oldA.say('バトンタッチ！', 1200);
    oldA.mode('running');
    oldA.face(-1);
    await Promise.all([
      moveTo(oldA, offscreenX(-1), y, 900, { ease: easeIn }),
      moveTo(newA, VB / 2, y, 700, { size: 34, arc: 10 }),
    ]);
    oldA.remove();
    newA.face(-1);
    return newA;
  }

  // ---------- ステージ ----------
  function stageOrder(stageIdx) {
    const chars = STAGES[stageIdx].chars.slice();
    if (save.mode === 'random') {
      for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
    }
    return chars;
  }

  function renderProgress(order, done) {
    const p = $('#progress');
    p.innerHTML = '';
    order.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'dot' + (i < done ? ' done' : '') + (i === done ? ' now' : '');
      d.textContent = i < done ? WORDS[c].emoji : '';
      p.appendChild(d);
    });
  }

  // ---------- アンドロイドの「もどる」ボタン ----------
  // あそんでいる ときに もどるを おすと、アプリを とじずに タイトルへ もどる
  function enterPlayHistory() {
    if (!history.state || !history.state.play) history.pushState({ play: true }, '');
  }
  window.addEventListener('popstate', () => {
    if ($('#screen-play').classList.contains('active') || document.querySelector('.overlay.show')) goTitle(true);
  });

  // ---------- あそんでいる あいだ がめんを くらく しない ----------
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { /* つかえない たんまつ */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('#screen-play').classList.contains('active')) keepAwake(true);
  });

  async function playStage(stageIdx) {
    cancelAll();
    enterPlayHistory();
    keepAwake(true);
    const my = epoch;
    const stage = STAGES[stageIdx];
    const order = stageOrder(stageIdx);
    showOverlay('#overlay-clear', false);
    showOverlay('#overlay-bye', false);
    showScreen('screen-play');
    resizeBoard();
    clearLetter();
    $('#actors').innerHTML = '';
    $('#fx').innerHTML = '';
    const label = $('#stage-label');
    label.textContent = `${stage.name} の だん`;
    label.style.background = stage.color;
    renderProgress(order, 0);

    try {
      let actor = new Actor(order[0]);
      actor.set(VB / 2, VB / 2, 34);
      actor.once('popin');
      Sound.pop();
      for (let i = 0; i < order.length; i++) {
        if (i > 0) actor = await swapActors(actor, order[i]);
        renderProgress(order, i);
        await playLetter(order[i], stage.color, actor);
        renderProgress(order, i + 1);
      }
      await sleep(300);
      if (my === epoch) stageClear(stageIdx, order);
    } catch (e) {
      ignoreCancel(e);
    }
  }

  function markCaught(c) {
    save.caught[c] = (save.caught[c] || 0) + 1;
    caughtToday.push(c);
    writeSave();
  }

  function confetti(el) {
    el.innerHTML = '';
    const colors = ['#ff6b6b', '#ffd56b', '#6bcBff', '#7ee08a', '#c08bff', '#ff9fd2'];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 2 + Math.random() * 2.5 + 's';
      p.style.animationDelay = Math.random() * 1.2 + 's';
      el.appendChild(p);
    }
  }

  // ---------- クリア → きょうは ここまで？ ----------
  async function stageClear(stageIdx, order) {
    const stage = STAGES[stageIdx];
    if (!save.cleared.includes(stageIdx)) save.cleared.push(stageIdx);
    const next = stageIdx + 1;
    save.unlocked = Math.max(save.unlocked, Math.min(next, STAGES.length - 1));
    writeSave();

    const ov = $('#overlay-clear');
    ov.querySelector('.clear-title').textContent = `${stage.name} の だん クリア！`;
    ov.querySelector('.parade').innerHTML = order.map(c => `<span>${WORDS[c].emoji}</span>`).join('');
    const ask = ov.querySelector('.ask');
    ask.classList.remove('show');
    confetti(ov.querySelector('.confetti'));
    showOverlay('#overlay-clear', true);
    Sound.fanfare();
    setTimeout(() => Sound.say('クリア！ すごいね！', { pitch: 1.5 }), 900);

    const peek = ov.querySelector('.next-peek');
    const more = $('#btn-more');
    if (next < STAGES.length) {
      const ns = STAGES[next];
      peek.innerHTML = `つぎは <b style="color:${ns.color}">${ns.name} の だん</b>！ みんな まってるよ` +
        `<div class="peekers">${ns.chars.map(c => `<span>${WORDS[c].emoji}</span>`).join('')}</div>`;
      more.textContent = 'まだ やる！';
      more.onclick = () => playStage(next);
    } else {
      peek.innerHTML = 'ぜんぶの だんを クリアしたよ！ ひらがな はかせだ！';
      more.textContent = 'もういちど あそぶ！';
      more.onclick = () => goTitle();
    }
    $('#btn-stop').onclick = () => bye();

    try {
      await sleep(2600);
      ask.classList.add('show');
      Sound.say('きょうは ここまでに する？', { pitch: 1.4 });
    } catch (e) {
      ignoreCancel(e);
    }
  }

  function bye() {
    cancelAll();
    showOverlay('#overlay-clear', false);
    const n = caughtToday.length;
    const total = Object.keys(save.caught).length;
    $('#overlay-bye .bye-text').innerHTML =
      `きょうは <b>${n}こ</b> つかまえたよ！<br>ずかん ${total} / ${Object.keys(WORDS).length}`;
    $('#overlay-bye .bye-parade').innerHTML = caughtToday.map(c => `<span>${WORDS[c].emoji}</span>`).join('');
    showOverlay('#overlay-bye', true);
    Sound.say('きょうも がんばったね。また あしたね！', { pitch: 1.4 });
  }

  // ---------- タイトル ----------
  function nextStageIdx() {
    for (let i = 0; i <= save.unlocked; i++) {
      if (!save.cleared.includes(i)) return i;
    }
    return save.unlocked;
  }

  function renderTitle() {
    document.querySelectorAll('.mode').forEach(b => b.classList.toggle('on', b.dataset.mode === save.mode));
    const map = $('#stage-map');
    map.innerHTML = '';
    const nx = nextStageIdx();
    STAGES.forEach((st, i) => {
      const b = document.createElement('button');
      b.className = 'stage-btn';
      b.style.background = st.color;
      b.textContent = st.name;
      b.setAttribute('aria-label', `${st.name} の だん`);
      if (i > save.unlocked) {
        b.classList.add('locked');
        b.disabled = true;
      } else {
        if (save.cleared.includes(i)) b.insertAdjacentHTML('beforeend', '<span class="star">⭐</span>');
        if (i === nx && !save.cleared.includes(i)) b.classList.add('next');
        b.onclick = () => { Sound.unlock(); playStage(i); };
      }
      map.appendChild(b);
    });
    $('#zukan-count').textContent = `${Object.keys(save.caught).length}/${Object.keys(WORDS).length}`;
  }

  function goTitle(fromBack) {
    cancelAll();
    keepAwake(false);
    if (!fromBack && history.state && history.state.play) history.back();
    ['#overlay-clear', '#overlay-bye', '#overlay-zukan'].forEach(id => showOverlay(id, false));
    $('#actors').innerHTML = '';
    clearLetter();
    renderTitle();
    showScreen('screen-title');
  }

  function renderZukan() {
    const grid = $('#zukan-grid');
    grid.innerHTML = '';
    STAGES.forEach(st => {
      const row = document.createElement('div');
      row.className = 'zukan-row';
      st.chars.forEach(c => {
        const got = save.caught[c];
        row.insertAdjacentHTML('beforeend',
          `<div class="zukan-cell${got ? ' got' : ''}">${c}${got ? `<span class="z-emoji">${WORDS[c].emoji}</span>` : ''}</div>`);
      });
      grid.appendChild(row);
    });
  }

  // ---------- ボタン ----------
  $('#btn-play').onclick = () => { Sound.unlock(); playStage(nextStageIdx()); };
  $('#btn-home').onclick = () => goTitle();
  $('#btn-bye').onclick = () => goTitle();
  document.querySelectorAll('.mode').forEach(b => {
    b.onclick = () => { save.mode = b.dataset.mode; writeSave(); renderTitle(); };
  });
  $('#btn-zukan').onclick = () => { renderZukan(); showOverlay('#overlay-zukan', true); };
  $('#btn-zukan-close').onclick = () => showOverlay('#overlay-zukan', false);
  $('#btn-reset').onclick = () => {
    if (confirm('すすんだ ステージと ずかんを ぜんぶ けして さいしょから に しますか？')) {
      save = defaultSave();
      writeSave();
      renderTitle();
    }
  };

  // ---------- インストール（ホームがめんに ついか）----------
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    $('#btn-install').hidden = false;
  });
  $('#btn-install').onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('#btn-install').hidden = true;
  };
  window.addEventListener('appinstalled', () => { $('#btn-install').hidden = true; });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* オフラインに ならないだけ */ });
  }

  // テストよう
  window.__game = { STAGES, get save() { return save; } };

  renderTitle();
})();
