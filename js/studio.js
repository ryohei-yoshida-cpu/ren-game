// 🎙 こえの スタジオ
//   ・ぜんぶの セリフを やくごとに ならべて、1つずつ ろくおん（● → ■）できる
//   ・「LINEで たのむ」: えらんだ セリフの ろくおんを、リンクで ともだちに おねがいする
//   ・おねがいの リンク（#koe=...）を ひらくと、その セリフだけの ろくおん がめんに なる
//   ・「おくる」: とった こえを こえパック（.txt）に して LINE などで おくる
//   ・「よみこむ」: もらった こえパックを いれる
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const { Sound, VoiceBox, WORDS, STAGES } = window;
  const ov = $('#overlay-studio');
  const list = $('#studio-list');
  const msg = $('#studio-msg');

  const ROLES = [
    { who: 'narr', name: 'ナレーション' },
    { who: 'kid', name: 'なかま' },
    { who: 'hime', name: 'おひめさま' },
    { who: 'wani', name: 'ワニ' },
    { who: 'foe', name: 'わるもの' },
  ];
  const ORIGINAL = { kid: 'ずんだもん', narr: '春日部つむぎ', hime: '四国めたん', wani: '玄野武宏', foe: '白上虎太郎' };
  const CHARS = Object.keys(WORDS);
  // あり だけが いう セリフ / さいごの だんの キャラだけが いう セリフ
  const ANT_ONLY = ['えへへ', 'たいへんだ！ おひめさまを たすけに いくぞ！', 'おひめさま、いま たすけるぞ！'];
  const LAST_ONLY = ['ありさん、たのんだ！'];
  const LAST_CHARS = STAGES[STAGES.length - 1].chars;

  let lines = [];          // { key, who, text, id, char }
  let tab = 'narr';
  let charSel = 'あ';      // なかま タブで えらんで いる キャラ（'kid' は みんな）
  let request = null;      // おねがい モード: { ids:Set, from }
  const picked = new Set();
  let recording = null;    // { key, ctl, btn }

  // セリフの いちらん。なかまの セリフは キャラごと（'c:い|...'）と みんな きょうつう（'kid|...'）
  async function loadLines() {
    if (lines.length) return;
    let idx = Sound.voiceIndex();
    if (!idx) idx = await (await fetch('audio/voice/index.json')).json();
    const all = Object.entries(idx).filter(([k]) => k !== '_v').map(([key, file]) => {
      const i = key.indexOf('|');
      return { key, who: key.slice(0, i), text: key.slice(i + 1), id: file.replace(/\.mp3$/, '') };
    });
    const isSong = t => /^(.)、\1、/.test(t);
    const common = all.filter(l => l.who === 'kid' && !isSong(l.text));
    lines = all.filter(l => l.who !== 'kid');
    // みんな（ここで とると ぜんぶの キャラが この こえに なる）
    common.filter(l => !ANT_ONLY.includes(l.text)).forEach(l => lines.push({ ...l, char: 'kid' }));
    CHARS.forEach((c, ci) => {
      const song = all.find(l => l.who === 'kid' && isSong(l.text) && l.text.startsWith(c + '、'));
      const mine = [song, ...common.filter(l =>
        (!ANT_ONLY.includes(l.text) || c === 'あ') && (!LAST_ONLY.includes(l.text) || LAST_CHARS.includes(c)))];
      mine.filter(Boolean).forEach(l => lines.push({ key: `c:${c}|${l.text}`, who: `c:${c}`, text: l.text, id: `${l.id}-${ci}`, char: c }));
    });
  }
  const roleOf = l => (l.char ? 'kid' : l.who);
  const charLabel = c => (c === 'kid' ? '👥 みんな' : `${WORDS[c].emoji} ${c}（${WORDS[c].word}）`);

  function myName() {
    return $('#studio-name').value.trim();
  }
  function say(t) {
    msg.textContent = t;
    msg.classList.remove('pop');
    void msg.offsetWidth;
    msg.classList.add('pop');
  }

  // ---- がめん ----
  function visible() {
    if (request) return lines.filter(l => request.ids.has(l.id));
    const q = $('#studio-search').value.trim();
    if (q) return lines.filter(l => l.text.includes(q));
    if (tab === 'kid') return lines.filter(l => l.char === charSel);
    return lines.filter(l => l.who === tab);
  }

  // なかま タブ: キャラを えらぶ
  function renderChars() {
    const box = $('#studio-chars');
    box.hidden = !!request || tab !== 'kid' || !!$('#studio-search').value.trim();
    if (box.hidden) return;
    box.innerHTML = ['kid', ...CHARS].map(c => {
      const n = lines.filter(l => l.char === c && VoiceBox.recorded(l.key)).length;
      return `<button class="schar${c === charSel ? ' on' : ''}${n ? ' has' : ''}" data-char="${c}">` +
        (c === 'kid' ? '👥<small>みんな</small>' : `${WORDS[c].emoji}<small>${c}</small>`) + '</button>';
    }).join('');
    box.querySelectorAll('.schar').forEach(b => {
      b.onclick = () => { charSel = b.dataset.char; render(); };
    });
  }

  function renderTabs() {
    $('#studio-tabs').innerHTML = ROLES.map(r => {
      const all = lines.filter(l => roleOf(l) === r.who);
      const mine = all.filter(l => VoiceBox.recorded(l.key)).length;
      return `<button class="stab${r.who === tab ? ' on' : ''}" data-who="${r.who}">${r.name}<small>${mine}/${all.length}</small></button>`;
    }).join('');
    $('#studio-tabs').querySelectorAll('.stab').forEach(b => {
      b.onclick = () => { tab = b.dataset.who; $('#studio-search').value = ''; render(); };
    });
  }

  function rowHTML(l) {
    const mine = VoiceBox.recorded(l.key);
    let who = mine ? `🎙 ${VoiceBox.by(l.key) || 'じぶん'} の こえ` : `もとの こえ（${ORIGINAL[roleOf(l)]}）`;
    if (l.char && !mine && l.char !== 'kid' && VoiceBox.recorded(`kid|${l.text}`)) who = `👥 みんなの こえ（${VoiceBox.by(`kid|${l.text}`)}）`;
    if (l.char && (request || $('#studio-search').value.trim())) who = `${charLabel(l.char)} ・ ${who}`;
    return `<div class="srow${mine ? ' mine' : ''}" data-key="${encodeURIComponent(l.key)}">` +
      (request ? '' : `<input type="checkbox" class="sr-pick" aria-label="えらぶ"${picked.has(l.key) ? ' checked' : ''}>`) +
      `<div class="sr-text">${l.text.replace(/</g, '&lt;')}<small>${who}</small></div>` +
      `<button class="sr-play" aria-label="きく">▶</button>` +
      `<button class="sr-rec" aria-label="ろくおん">●</button>` +
      `<button class="sr-reset" aria-label="もとに もどす"${mine ? '' : ' hidden'}>↺</button></div>`;
  }

  function render() {
    renderTabs();
    renderChars();
    $('#studio-tabs').hidden = !!request;
    $('#studio-search').hidden = !!request;
    $('#studio-ask').hidden = !!request;
    const rows = visible();
    let html = '';
    if (!request && tab === 'kid' && !$('#studio-search').value.trim()) {
      html += `<div class="sgroup">${charLabel(charSel)} の セリフ` +
        (charSel === 'kid' ? '<small>（ここで とると、じぶんの こえが ない キャラは みんな この こえに なるよ）</small>' : '') + '</div>';
    }
    for (const l of rows) html += rowHTML(l);
    list.innerHTML = html || '<p class="sempty">セリフが ないよ</p>';
    if (request) {
      const done = rows.filter(l => VoiceBox.recorded(l.key)).length;
      $('#studio-request').innerHTML =
        `📨 <b>${request.from || 'ともだち'}</b> から こえの おねがい！<br>ぜんぶで ${rows.length}こ（とった: ${done}こ）。🔴を おして よみあげてね`;
      $('#studio-send').textContent = `✅ できた！ おくりかえす（${done}こ）`;
    } else {
      $('#studio-send').textContent = `📤 とった こえを おくる（${VoiceBox.keys().length}こ）`;
      $('#studio-ask').textContent = `📨 えらんだ セリフを LINEで たのむ（${picked.size}こ）`;
    }
  }

  const updateRow = () => render();

  // ---- ろくおん ----
  async function startRec(l, btn) {
    if (recording) return;
    Sound.hush();
    recording = { key: l.key, pending: true };   // マイクが じゅんびできるまで ほかの ボタンは きかない
    try {
      const ctl = await VoiceBox.record();
      recording = { key: l.key, ctl, btn };
      btn.textContent = '■';
      btn.classList.add('on');
      btn.closest('.srow').classList.add('recording');
      say('🔴 ろくおんちゅう… よみおわったら ■ を おしてね');
      ctl.stopped.then(() => { if (recording && recording.ctl === ctl) stopRec(); });
    } catch (e) {
      recording = null;
      say(/unsupported/.test(e.message)
        ? 'この ブラウザでは ろくおん できないよ'
        : 'マイクが つかえないよ。LINEの なかで ひらいている ときは「ブラウザで ひらく」を えらんでね');
    }
  }
  async function stopRec() {
    const r = recording;
    if (!r || r.pending) return;
    recording = null;
    try {
      const wav = await r.ctl.stop();
      await VoiceBox.put(r.key, wav, myName() || 'じぶん');
      say('とれたよ！');
      const l = lines.find(x => x.key === r.key);
      Sound.say(l.text, { who: l.who });   // キャラの セリフは who が 'c:い' など
    } catch (e) {
      say(e.message === 'quiet' ? 'こえが きこえなかったよ。もういちど やってみてね' : 'うまく とれなかったよ。もういちど やってみてね');
    }
    updateRow(r.key);
  }

  list.addEventListener('click', e => {
    const row = e.target.closest('.srow');
    if (!row) return;
    const key = decodeURIComponent(row.dataset.key);
    const l = lines.find(x => x.key === key);
    if (e.target.classList.contains('sr-play')) {
      Sound.unlock();
      Sound.hush();
      Sound.say(l.text, { who: l.who });
    } else if (e.target.classList.contains('sr-rec')) {
      Sound.unlock();
      if (recording && recording.key === key) stopRec();
      else if (!recording) startRec(l, e.target);
    } else if (e.target.classList.contains('sr-reset')) {
      if (confirm(`「${l.text}」を もとの こえに もどしますか？`)) {
        VoiceBox.remove(key).then(() => updateRow(key));
      }
    } else if (e.target.classList.contains('sr-pick')) {
      if (e.target.checked) picked.add(key); else picked.delete(key);
      render();
    }
  });

  // ---- LINE で たのむ / おくる / よみこむ ----
  // LINE は メッセージと ファイルを いっしょに わたすと メッセージだけ おくって しまうので、ファイルだけ わたす
  async function shareFile(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        say('おくれたよ！ あいてには「📥 こえを よみこむ」で この ファイルを えらんで もらってね');
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    say('ファイルを ほぞん したよ。LINEの トークで「＋」→「ファイル」から この ファイルを おくってね');
    return true;
  }

  $('#studio-ask').onclick = async () => {
    if (!picked.size) return say('たのみたい セリフに ✓ を つけてね（タブごとに えらべるよ）');
    const ids = lines.filter(l => picked.has(l.key)).map(l => l.id);
    const name = myName() || 'ともだち';
    const url = `${location.origin}${location.pathname}#koe=${ids.join('.')}&from=${encodeURIComponent(name)}`;
    const text = `${name}より：「ひらがなまてまて」の こえを とって ほしいな！（セリフ ${ids.length}こ）\n` +
      'リンクを ひらいて、🔴ボタンで ろくおんしてね。LINEの なかで マイクが つかえない ときは、みぎうえの メニューから「ブラウザで ひらく」を えらんでね。';
    if (navigator.share) {
      try { await navigator.share({ title: 'こえの おねがい', text, url }); } catch (e) { /* やめた */ }
    } else {
      window.open('https://line.me/R/share?text=' + encodeURIComponent(`${text}\n${url}`), '_blank');
    }
  };

  $('#studio-send').onclick = async () => {
    const keys = request ? visible().map(l => l.key).filter(k => VoiceBox.recorded(k)) : VoiceBox.keys();
    if (!keys.length) return say('まだ こえを とって いないよ');
    if (!myName()) {
      $('#studio-name').focus();
      return say('さいしょに なまえを いれてね（だれの こえか わかるように）');
    }
    const { file, count } = await VoiceBox.exportPack(keys, myName());
    say(`こえパック（${count}こ）を つくったよ。LINEを えらんで おくってね`);
    await shareFile(file);
  };

  // ---- こえパックを よみこむ: なにを どこに いれるか えらぶ ----
  const dlg = $('#import-dialog');
  let pack = null;   // { by, groups: [{ from, target, items: [{ key, text, blob, song, on }] }] }
  const groupLabel = from => (from.startsWith('c:') ? charLabel(from.slice(2))
    : from === 'kid' ? charLabel('kid') : (ROLES.find(r => r.who === from) || { name: from }).name);
  const isSong = t => /^(.)、\1、/.test(t);
  // いれる さきの セリフの キー（うたは その キャラ だけ）
  function targetKey(g, it) {
    if (g.target === g.from) return it.key;
    if (it.song) return null;
    return `${g.target}|${it.text}`;   // target は 'kid' か 'c:い' など
  }

  function renderImport() {
    let total = 0;
    dlg.querySelector('.imp-body').innerHTML = pack.groups.map((g, gi) => {
      const canMove = g.from === 'kid' || g.from.startsWith('c:');
      const sel = canMove
        ? `<label class="imp-to">いれる さき <select data-g="${gi}">` +
          [`<option value="${g.from}">そのまま（${groupLabel(g.from)}）</option>`,
            ...['kid', ...CHARS].filter(c => (c === 'kid' ? 'kid' : 'c:' + c) !== g.from).map(c =>
              `<option value="${c === 'kid' ? 'kid' : 'c:' + c}"${g.target === (c === 'kid' ? 'kid' : 'c:' + c) ? ' selected' : ''}>${charLabel(c)}</option>`)].join('') +
          '</select></label>'
        : '';
      const rows = g.items.map((it, ii) => {
        const to = targetKey(g, it);
        if (to && it.on) total++;
        const note = !to ? '<small class="imp-skip">うたは この キャラ だけ</small>'
          : VoiceBox.recorded(to) ? '<small class="imp-over">うわがき</small>' : '';
        return `<div class="imp-row${to ? '' : ' off'}"><input type="checkbox" data-g="${gi}" data-i="${ii}"${it.on && to ? ' checked' : ''}${to ? '' : ' disabled'}>` +
          `<span>${it.text.replace(/</g, '&lt;')}${note}</span><button class="imp-play" data-g="${gi}" data-i="${ii}" aria-label="きく">▶</button></div>`;
      }).join('');
      return `<div class="imp-group"><div class="imp-head">${groupLabel(g.from)} <small>${g.items.length}こ</small></div>${sel}${rows}</div>`;
    }).join('');
    dlg.querySelector('.imp-title').textContent = `📥 ${pack.by || 'ともだち'} の こえパック`;
    $('#imp-ok').textContent = `${total}こ いれる`;
    $('#imp-ok').disabled = !total;
  }

  dlg.addEventListener('change', e => {
    const g = pack && pack.groups[e.target.dataset.g];
    if (!g) return;
    if (e.target.tagName === 'SELECT') g.target = e.target.value;
    else g.items[e.target.dataset.i].on = e.target.checked;
    renderImport();
  });
  // とどいた こえを ためしに きく
  let previewCtx = null;
  dlg.addEventListener('click', async e => {
    if (!e.target.classList.contains('imp-play')) return;
    const it = pack.groups[e.target.dataset.g].items[e.target.dataset.i];
    previewCtx = previewCtx || new (window.AudioContext || window.webkitAudioContext)();
    const buf = await previewCtx.decodeAudioData(await it.blob.arrayBuffer());
    const src = previewCtx.createBufferSource();
    const gain = previewCtx.createGain();
    gain.gain.value = VoiceBox.loudnessGain(buf.getChannelData(0), 0, buf.length, buf.sampleRate);
    src.buffer = buf;
    src.connect(gain).connect(previewCtx.destination);
    src.start();
  });
  $('#imp-cancel').onclick = () => { dlg.classList.remove('show'); pack = null; };
  $('#imp-ok').onclick = async () => {
    let n = 0;
    for (const g of pack.groups) {
      for (const it of g.items) {
        const to = targetKey(g, it);
        if (!to || !it.on) continue;
        await VoiceBox.put(to, it.blob, pack.by || 'ともだち');
        n++;
      }
    }
    dlg.classList.remove('show');
    say(`${pack.by || 'ともだち'} の こえを ${n}こ いれたよ！`);
    pack = null;
    render();
  };

  $('#studio-file').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      await loadLines();
      const r = await VoiceBox.readPack(f);
      const groups = new Map();
      for (const c of r.clips) {
        const i = c.key.indexOf('|');
        const from = c.key.slice(0, i), text = c.key.slice(i + 1);
        if (!groups.has(from)) groups.set(from, { from, target: from, items: [] });
        groups.get(from).items.push({ key: c.key, text, blob: c.blob, song: isSong(text), on: true });
      }
      pack = { by: r.by, groups: [...groups.values()] };
      renderImport();
      dlg.classList.add('show');
    } catch (err) {
      say('こえパックが よみこめなかったよ');
    }
  };

  $('#studio-name').addEventListener('change', () => {
    try { localStorage.setItem('voice-name', myName()); } catch (e) { /* むし */ }
  });
  $('#studio-use').onchange = e => { VoiceBox.enabled = e.target.checked; };
  $('#studio-search').addEventListener('input', render);

  // ---- ひらく / とじる ----
  async function open(req = null) {
    request = req;
    await VoiceBox.ready;
    await loadLines();
    try { $('#studio-name').value = localStorage.getItem('voice-name') || ''; } catch (e) { /* むし */ }
    $('#studio-use').checked = VoiceBox.enabled;
    $('#studio-request').hidden = !request;
    msg.textContent = /Line\//i.test(navigator.userAgent)
      ? 'LINEの なかでは ろくおん できない ことが あるよ。みぎうえの メニューから「ブラウザで ひらく」を えらんでね'
      : '';
    render();
    ov.classList.add('show');
    history.pushState({ studio: true }, '');
  }
  function close() {
    if (recording) { recording.ctl.cancel(); recording = null; }
    ov.classList.remove('show');
    if (request) {
      request = null;
      history.replaceState(null, '', location.pathname);
    }
  }
  $('#studio-close').onclick = () => {
    close();
    if (history.state && history.state.studio) history.back();
  };
  window.addEventListener('popstate', () => { if (ov.classList.contains('show')) close(); });
  $('#btn-studio').onclick = () => { Sound.unlock(); open(); };

  // おねがいの リンクから ひらいた とき
  const m = location.hash.match(/^#koe=([\w.-]+)(?:&from=([^&]*))?/);
  if (m) open({ ids: new Set(m[1].split('.')), from: decodeURIComponent(m[2] || '') });
})();
