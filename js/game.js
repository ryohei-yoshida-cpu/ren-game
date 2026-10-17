(() => {
  'use strict';

  const VB = 109; // KanjiVG の viewBox
  const SAVE_KEY = 'hiragana-oikakekko-v1';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = s => document.querySelector(s);
  const { WORDS, STAGES, STROKES, Sound, Hero, Medal } = window;
  const HERO_SPEED = 1.3;
  const PACE = 1.6;   // うごきの ゆっくりさ（おおきいほど のろのろ）

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
    constructor(c, info = WORDS[c]) {
      this.c = c;
      this.info = info;
      const el = document.createElement('div');
      el.className = 'actor';
      el.innerHTML =
        `<div class="body"><div class="rig"><span class="emoji">${this.info.emoji}</span></div></div>` +
        (c ? `<span class="badge">${c}</span>` : '') + `<div class="bubble"></div>`;
      $('#actors').appendChild(el);
      this.el = el;
      this.body = el.querySelector('.body');
      this.rig = el.querySelector('.rig');
      this.costume = null;
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
      this.el.classList.remove('idle', 'running', 'wiggle', 'happy', 'push');
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
    say(text, ms = 1800, { below = false } = {}) {
      this.bubbleEl.classList.toggle('below', below);
      this.bubbleEl.textContent = text;
      // がめんの はしで きれないように ずらす
      const b = this.bubbleEl;
      b.style.setProperty('--shift', '0px');
      const wrap = $('#board-wrap').getBoundingClientRect();
      const r = this.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, w = b.offsetWidth;
      let shift = 0;
      if (cx - w / 2 < wrap.left + 8) shift = wrap.left + 8 - (cx - w / 2);
      else if (cx + w / 2 > wrap.right - 8) shift = wrap.right - 8 - (cx + w / 2);
      b.style.setProperty('--shift', shift + 'px');
      this.bubbleEl.classList.add('show');
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = setTimeout(() => this.bubbleEl.classList.remove('show'), ms);
    }
    // ヒーローの すがたに なる
    equip(k) {
      this.costume = k;
      this.el.classList.add('hero', 'gear-' + k.gear);
      this.el.style.setProperty('--hero', k.color.main);
      this.rig.insertAdjacentHTML('afterbegin', Hero.gearSVG(k));
      this.rig.insertAdjacentHTML('beforeend', Hero.helmetSVG(k));
    }
    // ぶきを だして ポーズ
    pose(p) {
      const color = Hero.beamColor();
      p.weapons.forEach((w, i) => {
        const el = document.createElement('div');
        el.className = `weapon w${i}`;
        el.innerHTML = Hero.weaponSVG(w, color);
        this.rig.appendChild(el);
      });
      this.el.classList.add('posing', 'pose-' + p.id);
    }
    unpose() {
      this.rig.querySelectorAll('.weapon').forEach(w => w.remove());
      [...this.el.classList].filter(k => k === 'posing' || k.startsWith('pose-')).forEach(k => this.el.classList.remove(k));
    }
    get speed() { return this.costume ? HERO_SPEED : 1; }
    remove() { this.el.remove(); }
  }

  async function moveTo(actor, x, y, ms, { size = actor.size, arc = 0, ease = easeInOut } = {}) {
    const x0 = actor.x, y0 = actor.y, s0 = actor.size;
    actor.face(x - x0);
    await tween(ms * PACE / actor.speed, t => {
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
  function waitTap(target = board) {
    return new Promise((resolve, reject) => {
      const on = () => { off(); resolve(); };
      const off = () => target.removeEventListener('pointerdown', on);
      target.addEventListener('pointerdown', on);
      cleanups.push(() => { off(); reject(CANCEL); });
    });
  }

  // ---------- なぞる（にげる キャラを おいかける）----------
  function trace(letter, actor) {
    return new Promise((resolve, reject) => {
      const R = 14;      // ゆびが みちに ちかいと みなす はんけい
      const LOOK = 22;   // いちどに すすめる さいだい
      const ahead = () => Math.round(11 * actor.speed);  // キャラは ゆびの すこし さきを にげる（ヒーローは はやい）
      let si = 0, idx = 0, active = false, busy = false, lastBlip = 0;
      let tx = actor.x, ty = actor.y;
      let lastProgress = performance.now();
      const ring = svgEl('circle', { r: 6, class: 'ring' });
      gHint.appendChild(ring);

      const cur = () => letter[si];
      function placeRing() {
        const p = cur().pts[idx];
        ring.setAttribute('cx', p.x);
        ring.setAttribute('cy', p.y);
      }
      // キャラは めあての ばしょへ のろのろ ついていく
      function placeActor() {
        const s = cur();
        const p = s.pts[Math.min(s.pts.length - 1, idx + ahead())];
        tx = p.x;
        ty = p.y;
      }
      let raf = 0;
      let last = performance.now();
      function follow(now) {
        const dt = Math.min(50, now - last);
        last = now;
        if (!busy) {
          const k = 1 - Math.pow(1 - 0.035 * actor.speed, dt / 16.7);
          const dx = tx - actor.x;
          if (Math.abs(dx) > 0.4) actor.face(dx);
          actor.x += dx * k;
          actor.y += (ty - actor.y) * k;
          actor.apply();
        }
        raf = requestAnimationFrame(follow);
      }
      raf = requestAnimationFrame(follow);
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
        ring.style.display = 'none';
        // ヒーローは かくの はしで ぶきを だして かっこつける（さいごの かくは たたかいへ）
        if (actor.costume && si < letter.length - 1) {
          try {
            await heroPose(actor, si === letter.length - 1);
          } catch (e) { return; }
        }
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
        const j = Math.min(n.pts.length - 1, ahead());
        Sound.hop();
        actor.mode(null);
        try {
          await moveTo(actor, n.pts[j].x, n.pts[j].y, 450, { arc: 12 });
        } catch (e) { return; }
        actor.mode('wiggle');
        ring.style.display = '';
        placeRing();
        tx = actor.x;
        ty = actor.y;
        lastProgress = performance.now();
        busy = false;
      }

      // かいている とちゅうで「へんしん！」
      const btn = $('#btn-henshin');
      async function onHenshin(e) {
        e.preventDefault();
        if (busy || actor.costume) return;
        busy = true;
        active = false;
        btn.hidden = true;
        const x0 = actor.x, y0 = actor.y, s0 = actor.size;
        const S = 28;
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        try {
          await moveTo(actor, clamp(x0, S / 2, VB - S / 2), clamp(y0, S / 2 + 4, VB - S / 2), 250, { size: S });
          await transform(actor);
          await moveTo(actor, x0, y0, 300, { size: s0 });
        } catch (err) { return; }
        setMessage('ゆびで おいかけて なぞってね！');
        actor.mode('wiggle');
        lastProgress = performance.now();
        busy = false;
      }
      if (!actor.costume) {
        btn.hidden = false;
        btn.addEventListener('pointerdown', onHenshin);
        setMessage('なぞってね！');
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
        cancelAnimationFrame(raf);
        btn.hidden = true;
        btn.removeEventListener('pointerdown', onHenshin);
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

  // ---------- ヒーロー ----------
  async function transform(actor) {
    const k = Hero.costume(actor.info.word);
    Sound.henshin();
    Sound.say('ヒーロー へんしん！', { pitch: 1.3, rate: 1.1 });
    setMessage('ヒーロー へんしん！');
    board.classList.remove('flash');
    void board.offsetWidth;
    board.classList.add('flash');
    actor.mode(null);
    actor.el.classList.add('henshin');
    sparks(actor.x, actor.y, 10, ['⚡', '✨', '⭐']);
    await sleep(1100);
    actor.el.classList.remove('henshin');
    actor.equip(k);
    Sound.clank();
    await sleep(450);
    if (k.gear === 'jet') Sound.jet(); else Sound.whoosh();
    actor.say(`${k.name} さんじょう！`, 2200);
    setMessage(`${k.name} さんじょう！`);
    Sound.say(`${k.name}、さんじょう！`, { pitch: 1.2, rate: 1.05 });
    await sleep(1800);
  }

  async function heroPose(actor, big) {
    const p = Hero.pickPose();
    const x0 = actor.x, y0 = actor.y, s0 = actor.size;
    const S = Math.max(s0 * 1.6, 24);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    actor.mode(null);
    await moveTo(actor, clamp(x0, S / 2, VB - S / 2), clamp(y0 - 4, S / 2 + 4, VB - S / 2), 220, { size: S, ease: easeOutBack });
    actor.pose(p);
    Sound[p.sfx]();
    actor.say(p.phrase, big ? 1400 : 1000);
    Sound.say(p.phrase, { pitch: 1.3, rate: 1.2 });
    setTimeout(() => sparks(actor.x, actor.y - S / 3, big ? 10 : 6, ['✨', '⭐', '💥']), 300);
    await sleep(big ? 1500 : 1050);
    actor.unpose();
    await moveTo(actor, x0, y0, 200, { size: s0 });
  }

  // ---------- おしろ ----------
  // ワニの おしろ。ボードの そと（たてながの がめんでは うえ、よこながでは みぎ）に おく
  const TAUNTS = [
    'まだまだ やられないもんねー！',
    'ぜんぜん いたくないもんねー！',
    'いまのは くすぐったかった だけだもんねー！',
    'つぎは そうは いかないもんねー！',
    'おひめさまは わたさないもんねー！',
    'たまたま あたった だけだもんねー！',
    'サングラスが ずれた だけだもんねー！',
    'きょうは ちょうしが わるい だけだもんねー！',
    'ばんそうこう はれば へっちゃらだもんねー！',
    'お、おしろが ゆれてる… き、きのせいだもんねー！',
  ];
  // ばんそうこうを はる ばしょ（おしろの なかの %）
  const BANDAGE_SPOTS = [[30, 40, -10], [68, 34, 15], [50, 60, 5], [22, 68, -20], [78, 66, 25],
    [44, 24, -5], [60, 80, 10], [32, 86, -15], [74, 88, 20], [52, 42, 30]];
  const BANDAGE_SVG =
    '<svg viewBox="0 0 40 40">' + [45, -45].map(r =>
      `<g transform="rotate(${r} 20 20)"><rect x="2" y="13" width="36" height="14" rx="7" fill="#f6d7b0" stroke="#c08a56" stroke-width="1.5"/>` +
      `<rect x="15" y="14" width="10" height="12" fill="#e9bd8c"/></g>`).join('') + '</svg>';

  const castle = {
    el: $('#castle'), x: VB * 0.85, y: -14, size: 24,
    place() {
      const wrap = $('#board-wrap').getBoundingClientRect();
      const b = board.getBoundingClientRect();
      const u = VB / b.width;
      const above = (b.top - wrap.top) * u;
      const right = (wrap.right - b.right) * u;
      if (above >= 22) {
        this.size = Math.min(above * 0.92, 32);
        this.x = VB - this.size / 2 - 4;
        this.y = -above / 2;
      } else if (right >= 22) {
        this.size = Math.min(right * 0.8, 40);
        this.x = VB + right / 2;
        this.y = this.size / 2 + 6;
      } else {
        this.size = 18;
        this.x = VB - 10;
        this.y = 10;
      }
      this.el.style.left = (this.x / VB * 100) + '%';
      this.el.style.top = (this.y / VB * 100) + '%';
      this.el.style.setProperty('--s', this.size);
    },
    render(dmg, popLast = false) {
      this.el.classList.remove('exploded');
      this.el.querySelector('.bandages').innerHTML = BANDAGE_SPOTS.slice(0, dmg).map(([x, y, r], i) =>
        `<span class="bandage${popLast && i === dmg - 1 ? ' new' : ''}" style="left:${x}%;top:${y}%;--r:${r}deg">${BANDAGE_SVG}</span>`).join('');
    },
    shake() {
      this.el.classList.remove('shake');
      void this.el.offsetWidth;
      this.el.classList.add('shake');
    },
    explode() {
      this.el.classList.add('exploded');
    },
  };
  const damage = () => save.cleared.length;
  window.addEventListener('resize', () => castle.place());

  function makeCroc(size) {
    const a = new Actor(null, { emoji: '🐊', word: 'ワニ' });
    a.el.classList.add('croc');
    a.rig.insertAdjacentHTML('beforeend', '<span class="shades">🕶️</span>');
    a.size = size;
    return a;
  }
  function makePrincess(size) {
    const a = new Actor(null, { emoji: '🐜', word: 'おひめさま' });
    a.el.classList.add('princess');
    a.rig.insertAdjacentHTML('beforeend', '<span class="crown">👑</span><span class="ribbon">🎀</span>');
    a.size = size;
    return a;
  }

  // おしろから ワニが かおを だして くやしがる
  async function crocTaunt(text) {
    const croc = makeCroc(castle.size * 0.8);
    croc.el.classList.add('peek');
    croc.set(castle.x, castle.y + castle.size * 0.1, castle.size * 0.8);
    croc.face(-1);
    croc.once('popin');
    croc.say(text, 3200, { below: true });
    setMessage(text);
    Sound.say(text, { pitch: 0.7, rate: 1.05 });
    await sleep(3300);
    croc.remove();
  }

  // ---------- わるもの と たたかう ----------
  // れんだの つよさ（gain: 1かいで たまる / decay: 1びょうで へる）
  const FIGHTS = {
    normal: { gain: 9, decay: 5, start: 15, size: 28, label: 'れんだで おしかえせ！' },
    strong: { gain: 6, decay: 6, start: 10, size: 34, label: 'つよいぞ！ もっと れんだ！' },
    boss: { gain: 4, decay: 5, start: 5, size: 42, label: 'ボスだ！ ぜんりょくで れんだ！' },
  };

  async function clash(actor, foe, y) {
    const mid = VB / 2;
    actor.mode('running');
    foe.mode('running');
    await Promise.all([
      moveTo(actor, mid - actor.size / 2 + 2, y, 450, { ease: easeIn }),
      moveTo(foe, mid + foe.size / 2 - 2, y, 450, { ease: easeIn }),
    ]);
    Sound.bonk();
    actor.once('bonk');
    foe.once('bonk');
    sparks(mid, y - 6, 7, ['💥', '⭐', '✨']);
    actor.mode('push');
    foe.mode('push');
  }

  // kind: normal（3こめ）/ strong（5こめ。おしろへ ふっとばす）
  async function battle(actor, kind, ctx) {
    const cfg = FIGHTS[kind];
    const e = Hero.enemy();
    const foe = new Actor(null, { emoji: e.emoji, word: e.name });
    foe.el.classList.add('foe');
    if (kind === 'strong') foe.el.classList.add('strong');
    const y = VB * 0.58;
    svg.classList.add('dim');

    // おしろから でてくる
    castle.shake();
    Sound.door();
    foe.set(castle.x, castle.y, castle.size * 0.4);
    const intro = kind === 'strong' ? `つよい ${e.name} が でてきた！` : `あっ！ ${e.name} が でてきた！`;
    setMessage(intro);
    Sound.say(intro, { pitch: 1.3 });
    actor.mode('running');
    foe.mode('running');
    await Promise.all([
      moveTo(actor, VB * 0.28, y, 700, { size: 30, arc: 10 }),
      moveTo(foe, VB * 0.74, y, 1000, { size: cfg.size, arc: 26 }),
    ]);
    actor.mode('idle');
    foe.mode('idle');
    actor.face(1);
    foe.face(-1);
    foe.say(e.cry, 1600);
    Sound.say(e.cry, { pitch: 0.6, rate: 0.9 });
    await sleep(1300);

    await clash(actor, foe, y);
    await pushContest(actor, foe, y, cfg);

    actor.mode(null);
    foe.mode(null);
    if (!actor.costume) await transform(actor);
    await finisher(actor, foe, kind === 'strong' ? 'castle' : 'away');
    svg.classList.remove('dim');

    if (kind === 'strong') await castleHit(ctx);
  }

  // 5こめの てきが おしろに ぶつかった あと
  async function castleHit(ctx) {
    castle.shake();
    Sound.boom();
    sparks(castle.x, castle.y, 10, ['💥', '⭐', '💫']);
    if (ctx.newBandage) {
      castle.render(ctx.damageAfter, true);
      Sound.clank();
    }
    setMessage('おしろに ダメージ！');
    await sleep(1200);
    if (ctx.finaleDue) {
      Sound.rumble();
      castle.shake();
      setMessage('おしろが ゴゴゴゴ… ゆれてる！');
      await sleep(1600);
    } else {
      const text = ctx.newBandage ? TAUNTS[ctx.damageAfter - 1] : TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
      await crocTaunt(text);
    }
  }

  // れんだで おしかえす
  function pushContest(actor, foe, y, cfg) {
    return new Promise((resolve, reject) => {
      const gauge = $('#power');
      const fill = gauge.querySelector('.power-fill');
      gauge.querySelector('.power-label').textContent = cfg.label;
      gauge.hidden = false;
      setMessage('タップ タップ！');
      let power = cfg.start, taps = 0, lastTap = performance.now(), raf = 0, last = performance.now();
      const shouts = ['えいっ！', 'がんばれー！', 'まけないぞ！', 'もうすこし！'];
      const ha = actor.size / 2 - 2, hf = foe.size / 2 - 2;

      function onTap(ev) {
        ev.preventDefault();
        power = Math.min(100, power + cfg.gain);
        taps++;
        lastTap = performance.now();
        Sound.push(power / 100);
        sparks(actor.x + ha, y - 4 + Math.random() * 8, 2, ['💥', '✨']);
        if (taps % 5 === 0) actor.say(shouts[(taps / 5 - 1) % shouts.length], 900);
        if (taps === 7) foe.say('ぐぬぬ…', 1000);
        if (power >= 100) done();
      }
      function frame(now) {
        const dt = Math.min(50, now - last) / 1000;
        last = now;
        power = Math.max(0, power - cfg.decay * dt);  // わるものも おしかえしてくる
        const c = VB / 2 + (power - 40) / 100 * 22;
        const j = () => (Math.random() - 0.5) * 0.8;
        actor.x = c - ha + j(); actor.y = y + j(); actor.apply();
        foe.x = c + hf + j(); foe.y = y + j(); foe.apply();
        fill.style.width = power + '%';
        if (now - lastTap > 3500) {
          actor.say('タップして！', 1200);
          lastTap = now;
        }
        raf = requestAnimationFrame(frame);
      }
      function stop() {
        cancelAnimationFrame(raf);
        board.removeEventListener('pointerdown', onTap);
        gauge.hidden = true;
      }
      function done() {
        stop();
        resolve();
      }
      board.addEventListener('pointerdown', onTap);
      raf = requestAnimationFrame(frame);
      cleanups.push(() => { stop(); reject(CANCEL); });
    });
  }

  // dest: away（そとへ とんでいく）/ castle（おしろへ ふっとぶ）/ sky（そらの ほしに なる）
  async function finisher(actor, foe, dest, f = Hero.finisher(actor.costume)) {
    actor.face(1);
    // ためて…
    actor.el.classList.add('charge');
    Sound.charge();
    actor.say(f.name, 2600);
    setMessage(f.name);
    Sound.say(f.name, { pitch: 1.2, rate: 1.0 });
    sparks(actor.x, actor.y, 8, ['⚡', '✨']);
    await sleep(1300);
    actor.el.classList.remove('charge');
    actor.pose(f.pose);
    Sound[f.pose.sfx]();
    const fx = $('#fx');
    if (f.kind === 'sword') {
      await moveTo(actor, Math.min(foe.x + 20, VB - actor.size / 2), actor.y, 200, { ease: easeIn });
      const sl = document.createElement('div');
      sl.className = 'big-slash';
      sl.style.left = (foe.x / VB * 100) + '%';
      sl.style.top = (foe.y / VB * 100) + '%';
      fx.appendChild(sl);
      setTimeout(() => sl.remove(), 900);
    } else {
      const bm = document.createElement('div');
      bm.className = 'big-beam';
      const x0 = actor.x + actor.size * 0.35;
      bm.style.left = (x0 / VB * 100) + '%';
      bm.style.top = ((actor.y - actor.size * 0.12) / VB * 100) + '%';
      bm.style.width = ((foe.x - x0 + 6) / VB * 100) + '%';
      bm.style.setProperty('--beam', actor.costume.color.main);
      fx.appendChild(bm);
      setTimeout(() => bm.remove(), 1100);
      await sleep(350);
    }
    // やっつけた！
    board.classList.remove('flash');
    void board.offsetWidth;
    board.classList.add('flash');
    Sound.boom();
    foe.el.classList.add('defeated');
    sparks(foe.x, foe.y, 14, ['💥', '⭐', '✨', '🌟']);
    const cry = dest === 'sky' ? 'おぼえてろ〜！' : 'やられた〜！';
    foe.say(cry, 1400);
    Sound.say(cry, { pitch: 0.7 });
    await sleep(500);
    actor.unpose();
    if (dest === 'castle') {
      await moveTo(foe, castle.x, castle.y, 800, { size: castle.size * 0.5, arc: 30, ease: easeIn });
    } else if (dest === 'sky') {
      await moveTo(foe, VB * 0.8, -VB * 0.4, 1100, { size: 6, arc: 10, ease: easeIn });
      sparks(VB * 0.8, 4, 6, ['⭐', '✨']);
    } else {
      await moveTo(foe, offscreenX(1), -30, 700, { arc: 10, ease: easeIn });
    }
    foe.remove();
    actor.mode('happy');
    actor.say('せいぎの しょうり！', 1600);
    Sound.say('せいぎの しょうり！', { pitch: 1.3 });
    await sleep(1400);
  }

  // ---------- オープニング ----------
  async function intro() {
    castle.render(damage());
    const y = VB * 0.6;
    setMessage('');
    const princess = makePrincess(24);
    princess.set(VB * 0.32, y, 24);
    princess.once('popin');
    princess.mode('happy');
    princess.say('ランラン ラン♪', 2000);
    Sound.say('ランラン ラン', { pitch: 2 });
    await sleep(2200);

    const croc = makeCroc(34);
    croc.set(offscreenX(1), y, 34);
    croc.mode('running');
    Sound.whoosh();
    await moveTo(croc, VB * 0.74, y, 1000);
    croc.mode('idle');
    croc.face(-1);
    const line = 'ワニワニ〜！ おひめさまは いただきだもんねー！';
    croc.say(line, 3000);
    setMessage(line);
    Sound.say(line, { pitch: 0.7 });
    await sleep(3000);

    princess.mode(null);
    princess.say('きゃー！', 1200);
    Sound.say('きゃー', { pitch: 2 });
    croc.mode('running');
    await moveTo(croc, princess.x + 16, y, 400, { ease: easeIn });
    Sound.bonk();
    // ワニが おひめさまを かかえて おしろへ
    princess.say('たすけてー！', 3000);
    setMessage('おひめさまが さらわれた！');
    Sound.say('たすけてー！', { pitch: 2 });
    const c0 = { x: croc.x, y: croc.y, s: croc.size };
    const p0 = { s: princess.size };
    await tween(1600 * PACE, t => {
      croc.x = c0.x + (castle.x - c0.x) * t;
      croc.y = c0.y + (castle.y - c0.y) * t - Math.sin(Math.PI * t) * 20;
      croc.size = c0.s + (castle.size * 0.5 - c0.s) * t;
      croc.apply();
      croc.face(castle.x - c0.x);
      princess.size = p0.s + (castle.size * 0.35 - p0.s) * t;
      princess.x = croc.x - croc.size * 0.2;
      princess.y = croc.y - croc.size * 0.35;
      princess.apply();
    });
    croc.remove();
    princess.remove();
    castle.shake();
    Sound.door();
    await sleep(800);

    const ant = new Actor('あ');
    ant.set(offscreenX(-1), y, 32);
    ant.mode('running');
    await moveTo(ant, VB * 0.42, y, 900);
    ant.mode('idle');
    ant.face(1);
    const vow = 'たいへんだ！ おひめさまを たすけに いくぞ！';
    ant.say(vow, 3000);
    setMessage(vow);
    Sound.say(vow, { pitch: 1.4 });
    await sleep(3200);
    await crocTaunt('くやしかったら ここまで おいでー！ だもんねー！');
    ant.mode('running');
    await moveTo(ant, offscreenX(1), y, 700, { ease: easeIn });
    ant.remove();
    save.introSeen = true;
    writeSave();
  }

  // ---------- フィナーレ ----------
  async function finale(actor) {
    const y = VB * 0.6;
    svg.classList.add('fade');
    setMessage('おしろが…！');
    await moveTo(actor, VB * 0.25, y, 600, { size: 30, arc: 8 });
    actor.mode('idle');
    for (let i = 0; i < 2; i++) {
      castle.shake();
      Sound.rumble();
      await sleep(800);
    }
    // おしろ だいばくはつ
    castle.explode();
    Sound.boom();
    board.classList.remove('flash');
    void board.offsetWidth;
    board.classList.add('flash');
    sparks(castle.x, castle.y, 16, ['💥', '🔥', '⭐', '💫']);
    setMessage('おしろが ばくはつした！');
    Sound.say('おしろが ばくはつした！', { pitch: 1.4 });
    await sleep(1400);

    // ワニの ボスが でてくる
    const croc = makeCroc(castle.size * 0.5);
    croc.el.classList.add('boss');
    croc.set(castle.x, castle.y, castle.size * 0.5);
    const princess = makePrincess(castle.size * 0.4);
    princess.el.classList.add('trapped');
    princess.set(castle.x, castle.y, castle.size * 0.4);
    croc.mode('running');
    await Promise.all([
      moveTo(croc, VB * 0.74, y, 1000, { size: FIGHTS.boss.size, arc: 30 }),
      moveTo(princess, VB * 0.16, VB * 0.3, 1000, { size: 20, arc: 16 }),
    ]);
    croc.mode('idle');
    croc.face(-1);
    princess.say('たすけてー！', 1800);
    Sound.say('たすけてー！', { pitch: 2 });
    await sleep(1600);
    const rage = 'よくも おしろを〜！ ほんきで いくもんねー！';
    croc.say(rage, 3000);
    setMessage(rage);
    Sound.say(rage, { pitch: 0.6 });
    await sleep(3000);

    // さいごは ありの ヒーロー
    actor.say('ありさん、たのんだ！', 1600);
    Sound.say('ありさん、たのんだ！', { pitch: 1.5 });
    actor.mode('running');
    const ant = new Actor('あ');
    ant.set(offscreenX(-1), y, 30);
    ant.mode('running');
    await Promise.all([
      moveTo(actor, offscreenX(-1), y, 800, { ease: easeIn }),
      moveTo(ant, VB * 0.28, y, 1000),
    ]);
    actor.remove();
    ant.mode('idle');
    ant.face(1);
    const brave = 'おひめさま、いま たすけるぞ！';
    ant.say(brave, 2400);
    setMessage(brave);
    Sound.say(brave, { pitch: 1.4 });
    await sleep(2400);
    await transform(ant);

    await clash(ant, croc, y);
    await pushContest(ant, croc, y, FIGHTS.boss);
    ant.mode(null);
    croc.mode(null);
    await finisher(ant, croc, 'sky', {
      kind: 'beam', name: 'ひっさつ！ ひらがな ファイナル ビーム！', pose: { id: 'gun', weapons: ['blaster'], sfx: 'laser' },
    });

    // おひめさまを たすけた！
    princess.el.classList.remove('trapped');
    princess.el.style.zIndex = 3;
    princess.mode('happy');
    await moveTo(princess, Math.min(ant.x + 28, VB - 14), y, 1000, { size: 26, arc: 14 });
    princess.face(-1);
    ant.face(1);
    const thanks = 'ありがとう！ わたしの ヒーロー！';
    princess.say(thanks, 2400);
    setMessage(thanks);
    Sound.say(thanks, { pitch: 1.9 });
    await sleep(2600);
    // ほっぺに チュー
    princess.mode(null);
    await moveTo(princess, ant.x + 20, y - 3, 500);
    princess.say('チュッ♡', 1600);
    Sound.kiss();
    Sound.say('チュッ', { pitch: 2 });
    ant.el.classList.add('blush');
    sparks(ant.x + 5, ant.y - 8, 12, ['💕', '💗', '💖']);
    await sleep(1500);
    ant.mode('happy');
    princess.mode('happy');
    ant.say('え、えへへ…', 1800);
    Sound.say('えへへ', { pitch: 1.4 });
    await sleep(2200);
  }

  function showEnding() {
    save.ending = (save.ending || 0) + 1;
    writeSave();
    const ov = $('#overlay-ending');
    ov.querySelector('.ending-parade').innerHTML = Object.values(WORDS).map(w => `<span>${w.emoji}</span>`).join('');
    confetti(ov.querySelector('.confetti'));
    showOverlay('#overlay-ending', true);
    Sound.fanfare();
    setTimeout(() => Sound.say('おひめさまを たすけたよ！ ひらがな ぜんぶ クリア！ おめでとう！', { pitch: 1.5 }), 1000);
  }

  // ---------- メダル ゲット ----------
  async function medalGet(c) {
    const n = save.caught[c];
    const prev = n - 1;
    const upgrade = prev > 0 && Medal.step(prev) !== Medal.step(n);
    const pop = $('#medal-pop');
    const m = pop.querySelector('.mp-medal');
    const label = pop.querySelector('.mp-label');
    m.innerHTML = Medal.svg(c, upgrade ? prev : n);
    label.textContent = '';
    pop.classList.remove('show');
    void pop.offsetWidth;
    pop.classList.add('show');
    Sound.medal();
    await sleep(700);
    if (upgrade) {
      m.classList.add('spin');
      await sleep(400);
      m.innerHTML = Medal.svg(c, n);
      await sleep(400);
      m.classList.remove('spin');
      Sound.medalUp();
    }
    label.innerHTML = `${Medal.message(n)}<small>${n}かいめ ・ ${Medal.nextGoal(n)}</small>`;
    sparks(VB / 2, VB * 0.42, 10, ['✨', '⭐', '🌟']);
    Sound.say(Medal.message(n), { pitch: 1.4 });
    await sleep(2300);
    pop.classList.remove('show');
    await sleep(250);
  }

  // ---------- ひらがな ひとつぶん ----------
  async function playLetter(c, color, actor, fight, ctx) {
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
      const dur = Math.max(700, s.len * 20) / actor.speed;
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

    // 3こめと 5こめは おしろから わるものが でてくる
    if (fight) await battle(actor, fight, ctx);

    Sound.caught();
    actor.mode('happy');
    setMessage(fight ? 'やっつけた！ じょうず！' : 'かけた！ じょうず！');
    sparks(VB / 2, VB / 2, 12);
    await moveTo(actor, VB * 0.78, VB * 0.78, 500, { size: 24, arc: 10, ease: easeOutBack });
    actor.say(`${c}！`, 1500);
    Sound.sing(c, info.word);
    markCaught(c);
    await sleep(2300);
    await medalGet(c);
  }

  // ---------- なかまに なって こうたい ----------
  async function handover(oldA, c) {
    svg.classList.add('fade');
    const newA = new Actor(c);
    const y = VB / 2;
    newA.set(offscreenX(1), y, 30);
    newA.mode('running');
    oldA.mode('running');
    await Promise.all([
      moveTo(oldA, VB * 0.3, y, 700, { size: 30 }),
      moveTo(newA, VB * 0.72, y, 900),
    ]);
    clearLetter();
    oldA.mode('idle');
    newA.mode('idle');
    oldA.face(1);
    newA.face(-1);
    oldA.say('なかまに なって たすけてくれ！', 2400);
    Sound.say('なかまに なって、たすけてくれ！', { pitch: 1.3 });
    await sleep(2400);
    newA.once('popin');
    newA.mode('happy');
    newA.say('わかった！', 1600);
    Sound.caught();
    Sound.say('わかった！', { pitch: 1.8 });
    await sleep(1500);

    // こうたい
    oldA.say('まかせたよ！', 1200);
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

  // わるものが でるのは 3こめ と さいご（5こめ）だけ
  function fightKind(i, n) {
    if (i === n - 1) return 'strong';
    if (n >= 5 && i === 2) return 'normal';
    return null;
  }

  async function playStage(stageIdx) {
    cancelAll();
    enterPlayHistory();
    keepAwake(true);
    const my = epoch;
    const stage = STAGES[stageIdx];
    const order = stageOrder(stageIdx);
    showOverlay('#overlay-clear', false);
    showOverlay('#overlay-bye', false);
    showOverlay('#overlay-ending', false);
    showScreen('screen-play');
    resizeBoard();
    castle.place();
    castle.render(damage());
    clearLetter();
    $('#actors').innerHTML = '';
    $('#fx').innerHTML = '';
    $('#medal-pop').classList.remove('show');
    $('#btn-henshin').hidden = true;
    $('#power').hidden = true;
    svg.classList.remove('dim');
    const label = $('#stage-label');
    label.textContent = `${stage.name} の だん`;
    label.style.background = stage.color;
    renderProgress(order, 0);

    // この だんで おしろに ばんそうこうが ふえるか、さいごの たたかいに なるか
    const after = new Set([...save.cleared, stageIdx]).size;
    const ctx = {
      newBandage: !save.cleared.includes(stageIdx),
      damageAfter: after,
      finaleDue: after === STAGES.length && (!save.cleared.includes(stageIdx) || stageIdx === STAGES.length - 1),
    };

    try {
      if (stageIdx === 0 && !save.introSeen) await intro();
      let actor = new Actor(order[0]);
      actor.set(VB / 2, VB / 2, 34);
      actor.once('popin');
      Sound.pop();
      for (let i = 0; i < order.length; i++) {
        if (i > 0) actor = await handover(actor, order[i]);
        renderProgress(order, i);
        await playLetter(order[i], stage.color, actor, fightKind(i, order.length), ctx);
        renderProgress(order, i + 1);
      }
      await sleep(300);
      if (ctx.finaleDue) {
        markStageCleared(stageIdx);
        await finale(actor);
        if (my === epoch) showEnding();
        return;
      }
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
  function markStageCleared(stageIdx) {
    if (!save.cleared.includes(stageIdx)) save.cleared.push(stageIdx);
    save.unlocked = Math.max(save.unlocked, Math.min(stageIdx + 1, STAGES.length - 1));
    writeSave();
  }

  async function stageClear(stageIdx, order) {
    const stage = STAGES[stageIdx];
    markStageCleared(stageIdx);
    const next = stageIdx + 1;

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
      `きょうは <b>${n}こ</b> つかまえたよ！<br>メダル ${total} / ${Object.keys(WORDS).length}`;
    $('#overlay-bye .bye-parade').innerHTML =
      [...new Set(caughtToday)].map(c => `<span class="mini-medal">${Medal.svg(c, save.caught[c])}</span>`).join('');
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
    const d = damage();
    $('#castle-status').innerHTML = save.ending
      ? '👑 おひめさまを たすけた！ <small>（もういちど あそべるよ）</small>'
      : `🏰 ワニの おしろ <span class="cs-bars">${'✚'.repeat(d)}<i>${'✚'.repeat(STAGES.length - d)}</i></span> ${d}/${STAGES.length}`;
    $('#zukan-count').textContent = `${Object.keys(save.caught).length}/${Object.keys(WORDS).length}`;
  }

  function goTitle(fromBack) {
    cancelAll();
    keepAwake(false);
    if (!fromBack && history.state && history.state.play) history.back();
    ['#overlay-clear', '#overlay-bye', '#overlay-zukan', '#overlay-ending'].forEach(id => showOverlay(id, false));
    $('#actors').innerHTML = '';
    $('#btn-henshin').hidden = true;
    $('#medal-detail').classList.remove('show');
    clearLetter();
    renderTitle();
    showScreen('screen-title');
  }

  // ---------- メダル コレクション ----------
  function renderZukan() {
    const all = Object.keys(WORDS);
    $('#medal-summary').innerHTML = Medal.GOALS.map(([k, name]) => {
      const cnt = all.filter(c => (save.caught[c] || 0) >= k).length;
      return `<div class="ms-item">${Medal.svg('', k, 'ms-medal')}<b>${cnt}</b><span>${name}</span></div>`;
    }).join('');
    const grid = $('#zukan-grid');
    grid.innerHTML = '';
    STAGES.forEach(st => {
      const row = document.createElement('div');
      row.className = 'zukan-row';
      st.chars.forEach(c => {
        const n = save.caught[c] || 0;
        const b = document.createElement('button');
        b.className = 'medal-cell' + (n ? ' got' : '');
        b.innerHTML = Medal.svg(c, n) + `<span class="mc-count">${n ? `×${n}` : ''}</span>`;
        b.onclick = () => showMedalDetail(c);
        row.appendChild(b);
      });
      grid.appendChild(row);
    });
  }

  function showMedalDetail(c) {
    const n = save.caught[c] || 0;
    const d = $('#medal-detail');
    d.querySelector('.md-big').innerHTML = Medal.svg(c, n);
    d.querySelector('.md-word').innerHTML = n
      ? `${WORDS[c].emoji} ${c} … ${WORDS[c].word}の ${c}`
      : `${c} は まだ つかまえて いないよ`;
    d.querySelector('.md-count').textContent = n ? `${n}かい クリア` : '';
    d.querySelector('.md-goal').textContent = Medal.nextGoal(n);
    let ladder = '';
    for (let i = 1; i <= Medal.MAX; i++) {
      ladder += `<div class="ld${i <= n ? ' done' : ''}${i === Math.min(n, Medal.MAX) ? ' now' : ''}">` +
        `${Medal.svg(c, i)}<span>${i}</span></div>`;
    }
    d.querySelector('.md-ladder').innerHTML = ladder;
    d.classList.add('show');
    if (n) Sound.say(`${WORDS[c].word}の ${c}`, { pitch: 1.4 });
  }

  async function playIntro() {
    cancelAll();
    enterPlayHistory();
    showScreen('screen-play');
    resizeBoard();
    castle.place();
    clearLetter();
    $('#actors').innerHTML = '';
    $('#fx').innerHTML = '';
    $('#progress').innerHTML = '';
    const label = $('#stage-label');
    label.textContent = 'おはなし';
    label.style.background = '#e17055';
    try {
      await intro();
      goTitle();
    } catch (e) {
      ignoreCancel(e);
    }
  }

  // ---------- ボタン ----------
  $('#btn-play').onclick = () => { Sound.unlock(); playStage(nextStageIdx()); };
  $('#btn-home').onclick = () => goTitle();
  $('#btn-bye').onclick = () => goTitle();
  document.querySelectorAll('.mode').forEach(b => {
    b.onclick = () => { save.mode = b.dataset.mode; writeSave(); renderTitle(); };
  });
  $('#btn-zukan').onclick = () => { renderZukan(); showOverlay('#overlay-zukan', true); };
  $('#btn-story').onclick = () => { Sound.unlock(); playIntro(); };
  $('#btn-ending-home').onclick = () => goTitle();
  $('#btn-ending-medal').onclick = () => { goTitle(); renderZukan(); showOverlay('#overlay-zukan', true); };
  $('#btn-zukan-close').onclick = () => showOverlay('#overlay-zukan', false);
  $('#btn-detail-close').onclick = () => $('#medal-detail').classList.remove('show');
  $('#btn-reset').onclick = () => {
    if (confirm('すすんだ ステージと メダルを ぜんぶ けして さいしょから に しますか？')) {
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
    // あたらしい ばんに かわったら、タイトルがめんの ときだけ いちど よみなおす
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || !$('#screen-title').classList.contains('active')) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => { /* オフラインに ならないだけ */ });
  }

  // テストよう
  window.__game = { STAGES, get save() { return save; } };

  renderTitle();
})();
