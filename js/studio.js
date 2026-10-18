// 🎙 こえの スタジオ
//   ・ぜんぶの セリフを やくごとに ならべて、1つずつ ろくおん（● → ■）できる
//   ・「LINEで たのむ」: えらんだ セリフの ろくおんを、リンクで ともだちに おねがいする
//   ・おねがいの リンク（#koe=...）を ひらくと、その セリフだけの ろくおん がめんに なる
//   ・「おくる」: とった こえを こえパック（.txt）に して LINE などで おくる
//   ・「よみこむ」: もらった こえパックを いれる
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const { Sound, VoiceBox, WORDS, Hero } = window;
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

  let lines = [];          // { key, who, text, id, group }
  let tab = 'narr';
  let request = null;      // おねがい モード: { ids:Set, from }
  const picked = new Set();
  let recording = null;    // { key, ctl, btn }

  function groupOf(who, text) {
    if (who !== 'kid') return '';
    if (/^(.)、\1、/.test(text)) return 'うた';
    if (Hero.lines().titles.includes(text) || text === 'さんじょう！' ||
      Object.values(WORDS).some(w => w.word === text)) return 'ヒーローの なまえ';
    if (/^\S+の .$/.test(text)) return 'メダルの せつめい';
    return 'セリフ';
  }

  async function loadLines() {
    if (lines.length) return;
    let idx = Sound.voiceIndex();
    if (!idx) idx = await (await fetch('audio/voice/index.json')).json();
    lines = Object.entries(idx).filter(([k]) => k !== '_v').map(([key, file]) => {
      const i = key.indexOf('|');
      const who = key.slice(0, i), text = key.slice(i + 1);
      return { key, who, text, id: file.replace(/\.mp3$/, ''), group: groupOf(who, text) };
    });
  }

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
    return lines.filter(l => (q ? l.text.includes(q) : l.who === tab));
  }

  function renderTabs() {
    $('#studio-tabs').innerHTML = ROLES.map(r => {
      const all = lines.filter(l => l.who === r.who);
      const mine = all.filter(l => VoiceBox.recorded(l.key)).length;
      return `<button class="stab${r.who === tab ? ' on' : ''}" data-who="${r.who}">${r.name}<small>${mine}/${all.length}</small></button>`;
    }).join('');
    $('#studio-tabs').querySelectorAll('.stab').forEach(b => {
      b.onclick = () => { tab = b.dataset.who; $('#studio-search').value = ''; render(); };
    });
  }

  function rowHTML(l) {
    const mine = VoiceBox.recorded(l.key);
    const who = mine ? `🎙 ${VoiceBox.by(l.key) || 'じぶん'} の こえ` : `もとの こえ（${ORIGINAL[l.who]}）`;
    return `<div class="srow${mine ? ' mine' : ''}" data-key="${encodeURIComponent(l.key)}">` +
      (request ? '' : `<input type="checkbox" class="sr-pick" aria-label="えらぶ"${picked.has(l.key) ? ' checked' : ''}>`) +
      `<div class="sr-text">${l.text.replace(/</g, '&lt;')}<small>${who}</small></div>` +
      `<button class="sr-play" aria-label="きく">▶</button>` +
      `<button class="sr-rec" aria-label="ろくおん">●</button>` +
      `<button class="sr-reset" aria-label="もとに もどす"${mine ? '' : ' hidden'}>↺</button></div>`;
  }

  function render() {
    renderTabs();
    $('#studio-tabs').hidden = !!request;
    $('#studio-search').hidden = !!request;
    $('#studio-ask').hidden = !!request;
    const rows = visible();
    let html = '', group = null;
    for (const l of rows) {
      if (l.group && l.group !== group) {
        group = l.group;
        html += `<div class="sgroup">${group}</div>`;
      }
      html += rowHTML(l);
    }
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
      Sound.say(l.text, { who: l.who });
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
  async function shareFile(file, text) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'ひらがなまてまて こえパック', text });
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
    say('ファイルを ほぞん したよ。LINEの トークで「ファイル」から おくってね');
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
    await shareFile(file, `${myName()} の こえパック（${count}こ）です！ 「ひらがなまてまて」の 🎙こえ →「こえを よみこむ」で いれてね`);
  };

  $('#studio-file').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const r = await VoiceBox.importPack(f);
      say(`${r.by || 'ともだち'} の こえを ${r.count}こ いれたよ！`);
      render();
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
  const m = location.hash.match(/^#koe=([\w.]+)(?:&from=([^&]*))?/);
  if (m) open({ ids: new Set(m[1].split('.')), from: decodeURIComponent(m[2] || '') });
})();
