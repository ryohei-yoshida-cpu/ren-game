"""lines.json の セリフを VOICEVOX で よみあげて audio/voice/*.mp3 を つくる

    node tools/voices/lines.mjs
    VV_DIR=/path/to/voicevox python tools/voices/gen.py

VV_DIR には つぎを おいておく（README の「こえの つくりかた」を みてね）
    voicevox_onnxruntime-linux-x64-1.17.3/  open_jtalk_dic_utf_8-1.11/  vvms/*.vvm
すでに ある セリフは つくりなおさない（--all で ぜんぶ つくりなおす）
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "audio" / "voice"
VV = Path(os.environ.get("VV_DIR", "."))
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")

# だれの こえか（VOICEVOX の スタイル ID と よみかた）
VOICES = {
    "kid": dict(style=3, vvm="0.vvm", speed=1.05, pitch=0.0, intonation=1.3),    # ずんだもん（ひらがなの なかま）
    "narr": dict(style=8, vvm="0.vvm", speed=1.0, pitch=0.0, intonation=1.2),    # 春日部つむぎ（ナレーション）
    "hime": dict(style=0, vvm="0.vvm", speed=1.0, pitch=0.02, intonation=1.3),   # 四国めたん あまあま（おひめさま）
    "wani": dict(style=11, vvm="4.vvm", speed=1.0, pitch=-0.02, intonation=1.4),  # 玄野武宏（わるい ワニ）
    "foe": dict(style=34, vvm="9.vvm", speed=1.0, pitch=0.0, intonation=1.3),    # 白上虎太郎 おこ（わるもの）
}
VERSION = 2  # よみかたの せっていを かえたら あげる


def key(who, text):
    return f"{who}|{text}"


def to_speech(text):
    # VOICEVOX が よみやすい かたちに
    for a, b in (("〜", "ー"), ("♪", ""), ("♡", ""), ("…", "、")):
        text = text.replace(a, b)
    return text.strip()


def shorten_pauses(q, limit):
    # 「、」の ながい ま を みじかく して、テンポよく
    aps = q.accent_phrases
    for ap in aps:
        pm = ap.pause_mora
        if pm and pm.get("vowel_length", 0) > limit:
            pm["vowel_length"] = limit
            ap.pause_mora = pm
    q.accent_phrases = aps


def main():
    lines = json.loads((ROOT / "tools/voices/lines.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / "index.json"
    old = {} if "--all" in sys.argv or not index_path.exists() else json.loads(index_path.read_text())
    if old.get("_v") != VERSION:
        old = {}

    ort = Onnxruntime.load_once(filename=str(VV / "voicevox_onnxruntime-linux-x64-1.17.3/lib/libvoicevox_onnxruntime.so.1.17.3"))
    syn = Synthesizer(ort, OpenJtalk(str(VV / "open_jtalk_dic_utf_8-1.11")), cpu_num_threads=os.cpu_count() or 4)
    for vvm in sorted({v["vvm"] for v in VOICES.values()}):
        with VoiceModelFile.open(str(VV / "vvms" / vvm)) as m:
            syn.load_voice_model(m)

    index = {"_v": VERSION}
    made = 0
    for line in lines:
        k = key(line["who"], line["text"])
        name = hashlib.sha1(k.encode()).hexdigest()[:12] + ".mp3"
        index[k] = name
        if old.get(k) == name and (OUT / name).exists():
            continue
        v = VOICES[line["who"]]
        q = syn.create_audio_query(to_speech(line["text"]), v["style"])
        q.speed_scale = v["speed"]
        q.pitch_scale = v["pitch"]
        q.intonation_scale = v["intonation"]
        q.pre_phoneme_length = 0.05
        q.post_phoneme_length = 0.1
        shorten_pauses(q, 0.2 if line["text"].count("、") >= 2 else 0.3)
        wav = syn.synthesis(q, v["style"])
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            tmp.write(wav)
            tmp.flush()
            subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-i", tmp.name,
                            "-ac", "1", "-ar", "24000", "-b:a", "48k", str(OUT / name)], check=True)
        made += 1
        print(f"{made:4d} {line['who']:5s} {line['text']}")

    # つかわなくなった ファイルを けす
    keep = set(index.values())
    for f in OUT.glob("*.mp3"):
        if f.name not in keep:
            f.unlink()
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=0))
    print(f"done: {made} new, {len(index) - 1} total")


if __name__ == "__main__":
    main()
