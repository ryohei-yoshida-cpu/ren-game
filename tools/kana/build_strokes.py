"""KanjiVG から かきじゅんデータを あつめて js/strokes.js を つくる

    python3 tools/kana/build_strokes.py

・せいおん・だくおん・はんだくおん は KanjiVG の もじを そのまま つかう
・ようおん（きゃ など）は おおきい もじを ひだりに、ちいさい ゃゅょ を みぎしたに ならべる
・そくおん（っ）は ちいさい っ を おおきく して まんなかに
"""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/%05x.svg"

SEION = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
DAKU = "がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ"
YOON_HEAD = "きしちにひみりぎじびぴ"
SMALL = "ゃゅょ"


def fetch(c):
    s = urllib.request.urlopen(BASE % ord(c), timeout=30).read().decode()
    paths = re.findall(r'<path id="kvg:[0-9a-f]+-s(\d+)"[^>]*\sd="([^"]+)"', s)
    paths.sort(key=lambda p: int(p[0]))
    return [p[1] for p in paths]


TOKEN = re.compile(r"[MmCcSsLlHhVvZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?")
ARGS = {"M": 2, "C": 6, "S": 4, "L": 2, "H": 1, "V": 1, "Z": 0}


def parse(d):
    out, cmd = [], None
    toks = TOKEN.findall(d)
    i = 0
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in "Zz":
                out.append((cmd, []))
            continue
        n = ARGS[cmd.upper()]
        out.append((cmd, [float(x) for x in toks[i:i + n]]))
        i += n
        if cmd == "M":
            cmd = "L"
        elif cmd == "m":
            cmd = "l"
    return out


def transform(d, s, tx, ty):
    """すべての てんを s ばい して (tx, ty) ずらす（そうたいざひょうは s ばい だけ）"""
    parts = []
    for cmd, a in parse(d):
        if cmd.isupper():
            if cmd == "H":
                a = [a[0] * s + tx]
            elif cmd == "V":
                a = [a[0] * s + ty]
            else:
                a = [v * s + (tx if k % 2 == 0 else ty) for k, v in enumerate(a)]
        else:
            a = [v * s for v in a]
        parts.append(cmd + ",".join(f"{v:.2f}".rstrip("0").rstrip(".") for v in a))
    return "".join(parts)


def bbox(paths):
    """てんの はんい（せいぎょてんも ふくむ ざっくりした はんい）"""
    xs, ys = [], []
    for d in paths:
        x = y = 0.0
        for cmd, a in parse(d):
            up = cmd.isupper()
            c = cmd.upper()
            if c in "MLCS":
                pts = [(a[k], a[k + 1]) for k in range(0, len(a), 2)]
                pts = pts if up else [(x + px, y + py) for px, py in pts]
                for px, py in pts:
                    xs.append(px)
                    ys.append(py)
                x, y = pts[-1]
            elif c == "H":
                x = a[0] if up else x + a[0]
                xs.append(x)
            elif c == "V":
                y = a[0] if up else y + a[0]
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def fit(paths, box):
    """paths を box (x0, y0, x1, y1) の なかに おおきく おさめる（たてよこの わりあいは そのまま）"""
    x0, y0, x1, y1 = bbox(paths)
    bx0, by0, bx1, by1 = box
    s = min((bx1 - bx0) / (x1 - x0), (by1 - by0) / (y1 - y0))
    tx = bx0 + ((bx1 - bx0) - (x1 - x0) * s) / 2 - x0 * s
    ty = by1 - (y1 - y0) * s - y0 * s   # したに そろえる
    return [transform(d, s, tx, ty) for d in paths]


def main():
    out = {}
    for c in SEION + DAKU:
        out[c] = fetch(c)
        print(c, len(out[c]))
    small = {c: fetch(c) for c in SMALL + "っ"}
    for h in YOON_HEAD:
        head = fetch(h)
        for sm in SMALL:
            k = h + sm
            out[k] = fit(head, (6, 14, 66, 96)) + fit(small[sm], (66, 50, 103, 96))
            print(k, len(out[k]))
    out["っ"] = fit(small["っ"], (30, 46, 84, 94))   # ちいさい ことが わかる おおきさ
    print("っ", len(out["っ"]))
    with open(ROOT / "js/strokes.js", "w") as f:
        f.write("// Hiragana stroke data derived from KanjiVG (https://kanjivg.tagaini.net)\n")
        f.write("// Copyright (C) 2009-2011 Ulrich Apel. Licensed under CC BY-SA 3.0.\n")
        f.write("// https://creativecommons.org/licenses/by-sa/3.0/\n")
        f.write("// viewBox: 0 0 109 109 / ようおん・そくおんは tools/kana/build_strokes.py で くみあわせ\n")
        f.write("window.STROKES = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n")


if __name__ == "__main__":
    main()
