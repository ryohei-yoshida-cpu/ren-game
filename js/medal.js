// ひらがなメダル
// クリアするたびに すこしずつ いろが かわり、10かいめで にじメダルが かんせい
//   1 どう / 2 ひだり ぎん・みぎ どう / 3 ぎん / 4 ひだり きん・みぎ ぎん / 5 きん
//   6 ひだり プラチナ・みぎ きん / 7 プラチナ / 8 ひだり にじ・みぎ プラチナ
//   9 にじ（ふちは プラチナ）/ 10 にじ かんせい（ふちも にじ・キラキラ）
window.Medal = (() => {
  const MAX = 10;
  // [ひだり, みぎ, ふち]
  const STEPS = [null, 'BBB', 'SBB', 'SSS', 'GSS', 'GGG', 'PGG', 'PPP', 'RPP', 'RRP', 'RRR'];
  const NAMES = { B: 'どう', S: 'ぎん', G: 'きん', P: 'プラチナ', R: 'にじ' };
  // いろが ぜんぶ そろう かいすう
  const GOALS = [[1, 'どう'], [3, 'ぎん'], [5, 'きん'], [7, 'プラチナ'], [10, 'にじ']];

  const step = n => Math.min(n || 0, MAX);

  function svg(c, n, cls = '') {
    const s = step(n);
    const ribbon =
      `<path d="M28 0 L46 0 L56 42 L38 46 Z" fill="#ff6b6b"/><path d="M72 0 L54 0 L44 42 L62 46 Z" fill="#3a86ff"/>` +
      `<path d="M46 0 L54 0 L52 10 L48 10 Z" fill="#fff" opacity=".5"/>`;
    if (!s) {
      return `<svg class="medal empty ${cls}" viewBox="0 0 100 124">` +
        `<circle cx="50" cy="80" r="38" fill="#efe5d2" stroke="#d6c6a8" stroke-width="3" stroke-dasharray="6 5"/>` +
        `<text x="50" y="81" class="medal-char${c.length > 1 ? ' two' : ''}" fill="#cdbb9b">${c}</text></svg>`;
    }
    const [L, R, F] = STEPS[s];
    const sparkle = s === MAX
      ? `<g class="twinkle" fill="#fff"><path d="M18 50 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/>` +
        `<path d="M84 98 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/><path d="M86 52 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z"/></g>`
      : '';
    return `<svg class="medal step-${s} ${cls}" viewBox="0 0 100 124">${ribbon}` +
      `<circle cx="50" cy="80" r="41" fill="url(#md-${F})" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/>` +
      `<path d="M50 46 A34 34 0 0 0 50 114 Z" fill="url(#md-${L})"/>` +
      `<path d="M50 46 A34 34 0 0 1 50 114 Z" fill="url(#md-${R})"/>` +
      `<circle cx="50" cy="80" r="34" fill="none" stroke="rgba(0,0,0,.15)" stroke-width="1.2"/>` +
      `<circle cx="50" cy="80" r="27" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>` +
      `<text x="50" y="81" class="medal-char${c.length > 1 ? ' two' : ''}">${c}</text>${sparkle}</svg>`;
  }

  function message(n) {
    return [
      '',
      'どうメダル ゲット！',
      'はんぶん ぎんいろに なった！',
      'ぎんメダルに なった！',
      'はんぶん きんいろに なった！',
      'きんメダルに なった！',
      'はんぶん プラチナに なった！',
      'プラチナメダルに なった！',
      'はんぶん にじいろに なった！',
      'にじメダルまで あと すこし！',
      'にじメダル かんせい！',
    ][step(n)] || 'にじメダル ピカピカ！';
  }

  function nextGoal(n) {
    const g = GOALS.find(([k]) => k > (n || 0));
    if (!g) return 'にじメダル かんせい！ すごい！';
    return `あと ${g[0] - (n || 0)}かいで ${g[1]}メダル！`;
  }

  // いちばん いい いろ（そろった もの）
  function tier(n) {
    let t = null;
    GOALS.forEach(([k, name]) => { if ((n || 0) >= k) t = name; });
    return t;
  }

  return { MAX, step, svg, message, nextGoal, tier, GOALS, NAMES };
})();
