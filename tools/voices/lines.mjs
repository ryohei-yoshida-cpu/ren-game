// ゲームで しゃべる セリフを ぜんぶ あつめて lines.json に かきだす
//   node tools/voices/lines.mjs
// game.js の Sound.say('...', { who: '...' }) と、データから つくる セリフを ひろう
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['js/data.js', 'js/hero.js', 'js/medal.js']) vm.runInContext(read(f), ctx);
const { WORDS, Hero, Medal } = ctx.window;
const game = read('js/game.js');

const lines = [];
const add = (who, text) => lines.push({ who, text: text.trim() });

// game.js に そのまま かいてある セリフ
for (const m of game.matchAll(/Sound\.say\('([^']+)',\s*\{\s*who:\s*'(\w+)'/g)) add(m[2], m[1]);
for (const m of game.matchAll(/crocTaunt\('([^']+)'\)/g)) add('wani', m[1]);
const arr = name => vm.runInNewContext(game.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`))[1]);
arr('FLEE').forEach(t => add('wani', t));
arr('ARRIVE').forEach(t => add('wani', t));
const constLine = (name, who) => add(who, game.match(new RegExp(`const ${name} = '([^']+)';`))[1]);
constLine('line', 'wani');
constLine('vow', 'kid');
constLine('rage', 'wani');
constLine('brave', 'kid');
constLine('thanks', 'hime');
for (const m of game.matchAll(/name: '(ひっさつ[^']+)'/g)) add('kid', m[1]);
add('foe', 'やられた〜！');
add('wani', 'おぼえてろ〜！');

// データから つくる セリフ
for (const [c, w] of Object.entries(WORDS)) {
  add('kid', `${c}、${c}、${w.word}の ${c}！`);   // うた（Sound.sing）
  add('kid', `${w.word}の ${c}`);                 // メダルの せつめい
  add('kid', w.word);                             // ヒーローの なまえ
}
for (let n = 1; n <= Medal.MAX + 1; n++) add('narr', Medal.message(n));
const h = Hero.lines();
h.titles.forEach(t => add('kid', t));
add('kid', 'さんじょう！');
h.poses.forEach(t => add('kid', t));
h.finishers.forEach(t => add('kid', t));
for (const e of h.enemies) {
  add('foe', e.cry);
  add('narr', `あっ！ ${e.name} が でてきた！`);
  add('narr', `つよい ${e.name} が でてきた！`);
}

const seen = new Set();
const out = lines.filter(l => {
  const k = `${l.who}|${l.text}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
fs.writeFileSync(path.join(root, 'tools/voices/lines.json'), JSON.stringify(out, null, 1));
console.log(`${out.length} lines`);
