// ヒーロー へんしんの みため（ヘルメット・マント・ジェット・ぶき・ポーズ）
// まいかい ランダムに くみあわせるので「どんな へんしんかな？」が たのしめる
window.Hero = (() => {
  const COLORS = [
    { name: 'レッド', main: '#ff4757', dark: '#b8222f' },
    { name: 'ブルー', main: '#3a86ff', dark: '#1d4ed8' },
    { name: 'イエロー', main: '#ffd60a', dark: '#c99700' },
    { name: 'グリーン', main: '#2ec27e', dark: '#17804f' },
    { name: 'ピンク', main: '#ff6fb5', dark: '#c2337a' },
    { name: 'ブラック', main: '#3d3d4e', dark: '#15151f' },
    { name: 'シルバー', main: '#d5dde6', dark: '#7d8a99' },
    { name: 'ゴールド', main: '#ffc83d', dark: '#b07d00' },
  ];
  const VISORS = ['#1b263b', '#00b4d8', '#ff3d7f', '#7b2ff7', '#ff9f1c', '#2ec4b6'];
  const CRESTS = ['v', 'horn', 'star', 'antenna', 'wing', 'fin', 'cat', 'crown'];
  const GOLD = '#ffd60a', GOLD_D = '#b88a00';
  const JET_PREFIX = ['ジェット', 'スカイ', 'ロケット'];
  const CAPE_PREFIX = ['スーパー', 'キャプテン', 'ナイト'];

  const pick = a => a[Math.floor(Math.random() * a.length)];

  function costume(word) {
    const color = pick(COLORS);
    const gear = pick(['cape', 'jet']);
    const prefix = gear === 'jet' ? pick(JET_PREFIX) : pick(CAPE_PREFIX);
    return {
      color,
      visor: pick(VISORS.filter(v => v !== color.main)),
      crest: pick(CRESTS),
      gear,
      cape: pick(COLORS.filter(c => c !== color)).main,
      name: `${prefix}${color.name} ${word}`,
      title: `${prefix}${color.name}`,
      word,
    };
  }

  function star(cx, cy, r, attrs) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 ? r * 0.45 : r;
      pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(' ')}" ${attrs}/>`;
  }

  function helmetSVG(k) {
    const { main, dark } = k.color;
    const gold = `fill="${GOLD}" stroke="${GOLD_D}" stroke-width="2" stroke-linejoin="round"`;
    const crests = {
      v: [``, `<path d="M50 24 L22 -8 L30 -11 L50 8 L70 -11 L78 -8 Z" ${gold}/>`],
      horn: [``, `<path d="M43 20 L50 -20 L57 20 Z" ${gold}/>`],
      star: [``, star(50, 6, 15, gold)],
      crown: [``, `<path d="M27 20 L29 -6 L40 8 L50 -14 L60 8 L71 -6 L73 20 Z" ${gold}/>` +
        `<circle cx="50" cy="8" r="4" fill="#ff3d7f"/>`],
      antenna: [`<g stroke="${dark}" stroke-width="3.5" stroke-linecap="round"><line x1="36" y1="18" x2="24" y2="-8"/><line x1="64" y1="18" x2="76" y2="-8"/></g>` +
        `<circle cx="24" cy="-8" r="7" fill="${k.visor}" stroke="${dark}" stroke-width="2"/><circle cx="76" cy="-8" r="7" fill="${k.visor}" stroke="${dark}" stroke-width="2"/>`, ``],
      wing: [`<path d="M14 50 Q-18 34 -14 4 Q2 26 22 30 Z" fill="#fff" stroke="#9fb4c7" stroke-width="2.5"/>` +
        `<path d="M86 50 Q118 34 114 4 Q98 26 78 30 Z" fill="#fff" stroke="#9fb4c7" stroke-width="2.5"/>`, ``],
      fin: [`<path d="M32 22 Q50 -26 68 22 Z" fill="${dark}" stroke="${GOLD}" stroke-width="3"/>`, ``],
      cat: [`<path d="M14 40 L16 -2 L44 18 Z" fill="${main}" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>` +
        `<path d="M86 40 L84 -2 L56 18 Z" fill="${main}" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>`, ``],
    }[k.crest];
    return `<svg class="helmet" viewBox="0 0 100 80" overflow="visible">${crests[0]}` +
      `<path d="M8 70 Q8 12 50 10 Q92 12 92 70 Q50 62 8 70 Z" fill="${main}" stroke="${dark}" stroke-width="3"/>` +
      `<path d="M22 28 Q32 18 46 16" stroke="#fff" stroke-opacity=".75" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `<path d="M13 50 Q50 34 87 50 L85 65 Q50 55 15 65 Z" fill="${k.visor}" stroke="${dark}" stroke-width="2.5"/>` +
      `<path d="M24 50 Q38 44 52 43" stroke="#fff" stroke-opacity=".85" stroke-width="3.5" fill="none" stroke-linecap="round"/>` +
      `<circle cx="9" cy="58" r="8" fill="${dark}"/><circle cx="91" cy="58" r="8" fill="${dark}"/>` +
      `<circle cx="9" cy="58" r="3.5" fill="${GOLD}"/><circle cx="91" cy="58" r="3.5" fill="${GOLD}"/>` +
      `${crests[1]}</svg>`;
  }

  function gearSVG(k) {
    if (k.gear === 'cape') {
      return `<svg class="gear cape" viewBox="0 0 100 100" overflow="visible">` +
        `<path d="M6 4 Q40 -2 54 6 Q72 46 98 94 Q76 84 62 98 Q48 86 32 98 Q22 60 6 4 Z" fill="${k.cape}" stroke="rgba(0,0,0,.25)" stroke-width="2"/>` +
        `<path d="M30 10 Q46 50 46 92" stroke="rgba(0,0,0,.15)" stroke-width="5" fill="none"/>` +
        `<path d="M14 8 Q30 4 46 8" stroke="${GOLD}" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;
    }
    const { main, dark } = k.color;
    return `<svg class="gear jet" viewBox="0 0 60 110" overflow="visible">` +
      `<g class="flame"><path d="M7 62 Q15 112 23 62 Z" fill="#ff7b00"/><path d="M11 62 Q15 92 19 62 Z" fill="#ffe14d"/>` +
      `<path d="M37 62 Q45 112 53 62 Z" fill="#ff7b00"/><path d="M41 62 Q45 92 49 62 Z" fill="#ffe14d"/></g>` +
      `<rect x="4" y="8" width="22" height="50" rx="10" fill="#e6ecf2" stroke="${dark}" stroke-width="2.5"/>` +
      `<rect x="34" y="8" width="22" height="50" rx="10" fill="#e6ecf2" stroke="${dark}" stroke-width="2.5"/>` +
      `<rect x="4" y="24" width="22" height="9" fill="${main}"/><rect x="34" y="24" width="22" height="9" fill="${main}"/>` +
      `<rect x="22" y="18" width="16" height="26" rx="4" fill="${dark}"/>` +
      `<path d="M8 58 L22 58 L20 66 L10 66 Z" fill="#55606e"/><path d="M38 58 L52 58 L50 66 L40 66 Z" fill="#55606e"/></svg>`;
  }

  // ぶき（ぜんぶ うえむき・にぎりが した）
  function weaponSVG(kind, color) {
    if (kind === 'sword') {
      return `<svg viewBox="0 0 40 100" overflow="visible">` +
        `<path d="M20 0 L27 10 L27 66 L13 66 L13 10 Z" fill="url(#hx-blade)" stroke="#6b7a8c" stroke-width="1.5"/>` +
        `<line x1="20" y1="9" x2="20" y2="62" stroke="#fff" stroke-width="2" opacity=".9"/>` +
        `<rect x="2" y="63" width="36" height="8" rx="4" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="1.5"/>` +
        `<rect x="16" y="71" width="8" height="20" rx="3" fill="#7a4b2a"/>` +
        `<circle cx="20" cy="94" r="5" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="1.5"/>` +
        `<path class="glint" d="M20 -14 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#fff"/></svg>`;
    }
    if (kind === 'saber') {
      return `<svg viewBox="0 0 40 100" overflow="visible">` +
        `<rect class="blade" x="14" y="-6" width="12" height="74" rx="6" fill="#fff" stroke="${color}" stroke-width="6" style="filter:drop-shadow(0 0 5px ${color})"/>` +
        `<rect x="13" y="66" width="14" height="30" rx="3" fill="#3d3d4e"/>` +
        `<rect x="13" y="72" width="14" height="4" fill="#9aa5b1"/><rect x="13" y="82" width="14" height="4" fill="#9aa5b1"/>` +
        `<circle cx="20" cy="92" r="2.5" fill="${color}"/></svg>`;
    }
    // ブラスター
    return `<svg viewBox="0 0 40 100" overflow="visible">` +
      `<rect class="beam" x="14" y="-170" width="12" height="172" rx="6" fill="${color}" style="filter:drop-shadow(0 0 6px ${color})"/>` +
      `<circle class="muzzle" cx="20" cy="4" r="8" fill="${color}"/>` +
      `<rect x="14" y="4" width="12" height="38" rx="5" fill="#d5dde6" stroke="#55606e" stroke-width="1.5"/>` +
      `<rect x="11" y="14" width="18" height="5" rx="2.5" fill="${color}"/><rect x="11" y="26" width="18" height="5" rx="2.5" fill="${color}"/>` +
      `<path d="M6 40 Q20 30 34 40 L34 64 Q20 72 6 64 Z" fill="${color}" stroke="#55606e" stroke-width="1.5"/>` +
      `<path d="M6 46 L-3 62 L6 62 Z" fill="${GOLD}"/><path d="M34 46 L43 62 L34 62 Z" fill="${GOLD}"/>` +
      `<rect x="15" y="64" width="10" height="30" rx="4" fill="#3d3d4e"/></svg>`;
  }

  const POSES = [
    { id: 'sword-up', weapons: ['sword'], phrase: 'シャキーン！', sfx: 'sword' },
    { id: 'slash', weapons: ['sword'], phrase: 'ズバッ！', sfx: 'slash' },
    { id: 'double', weapons: ['sword', 'sword'], phrase: 'ダブル ソード！', sfx: 'sword' },
    { id: 'saber', weapons: ['saber'], phrase: 'ビーム セイバー！', sfx: 'saber' },
    { id: 'gun', weapons: ['blaster'], phrase: 'バキューン！', sfx: 'laser' },
    { id: 'twirl', weapons: ['blaster'], phrase: 'きまった！', sfx: 'twirl' },
  ];
  let lastPose = null;
  function pickPose() {
    const p = pick(POSES.filter(x => x !== lastPose));
    lastPose = p;
    return p;
  }
  const BEAM_COLORS = ['#00e5ff', '#ff3d7f', '#7cff4d', '#ffd60a', '#b26bff'];

  // もじの さいごに でてくる わるもの
  const ENEMIES = [
    { emoji: '👾', name: 'ギザギザン', cry: 'ギザギザー！' },
    { emoji: '🦖', name: 'ガオザウルス', cry: 'がおー！' },
    { emoji: '🤖', name: 'ガラクタロボ', cry: 'ガガガー！' },
    { emoji: '👹', name: 'オニオニ', cry: 'おにおにー！' },
    { emoji: '🐲', name: 'ドラドラ', cry: 'ドラー！' },
    { emoji: '🦇', name: 'コウモリン', cry: 'キーキー！' },
    { emoji: '🦂', name: 'サソリン', cry: 'チクチクー！' },
  ];
  let lastEnemy = null;
  function enemy() {
    const e = pick(ENEMIES.filter(x => x !== lastEnemy));
    lastEnemy = e;
    return e;
  }

  // ひっさつわざ（けん か じゅう）
  function finisher(k) {
    return Math.random() < 0.5
      ? { kind: 'sword', name: `ひっさつ！ ${k.color.name} スラッシュ！`, pose: POSES.find(p => p.id === 'slash') }
      : { kind: 'beam', name: `ひっさつ！ ${k.color.name} ビーム！`, pose: POSES.find(p => p.id === 'gun') };
  }

  // こえの ファイルを つくる ための ぜんぶの セリフ（tools/voices で つかう）
  function lines() {
    return {
      titles: [...JET_PREFIX, ...CAPE_PREFIX].flatMap(p => COLORS.map(c => p + c.name)),
      poses: POSES.map(p => p.phrase),
      finishers: COLORS.flatMap(c => [`ひっさつ！ ${c.name} スラッシュ！`, `ひっさつ！ ${c.name} ビーム！`]),
      enemies: ENEMIES,
    };
  }

  return { costume, helmetSVG, gearSVG, weaponSVG, pickPose, enemy, finisher, lines, beamColor: () => pick(BEAM_COLORS) };
})();
