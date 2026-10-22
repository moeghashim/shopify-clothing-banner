#!/usr/bin/env python3
"""Cut the two recordings from video/record.mjs into docs/how-it-works.mp4 (+ a GIF and a poster).

Needs ffmpeg with the drawtext filter, and the DejaVu fonts (or set FONT / FONT_REGULAR).
    python3 video/compose.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
DOCS = os.path.join(HERE, "..", "docs")
FONT = os.environ.get("FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
FONT_REGULAR = os.environ.get("FONT_REGULAR", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
BG = "0x1b2030"
ENC = ["-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-an"]


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=OUT)
    if result.returncode:
        sys.exit(f"{' '.join(cmd)[:240]}\n{result.stderr[-1200:]}")


def textfile(name, text):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(text)
    return name


def scene(src, segments, vf, name):
    """segments: (start, end, speed, caption). Returns the scene duration and the caption timeline."""
    clips, t, timeline = [], 0.0, []
    for i, (a, b, speed, caption) in enumerate(segments):
        clip = f"{name}_{i}.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-ss", str(a), "-to", str(b), "-i", src, "-vf", f"{vf},setpts=PTS/{speed}", *ENC, clip])
        duration = (b - a) / speed
        timeline.append((t, t + duration, caption))
        t += duration
        clips.append(clip)
    with open(os.path.join(OUT, f"{name}.txt"), "w") as f:
        f.write("".join(f"file '{c}'\n" for c in clips))
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", f"{name}.txt", "-c", "copy", f"{name}_raw.mp4"])
    return t, timeline


def card(name, title, subtitle, seconds, title_size=64, subtitle_size=30):
    t1, t2 = textfile(f"{name}_title.txt", title), textfile(f"{name}_sub.txt", subtitle)
    fade = f"fade=t=in:st=0:d=0.5,fade=t=out:st={seconds - 0.5}:d=0.5"
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c={BG}:s=1280x720:r=30:d={seconds}", "-vf",
         f"drawtext=fontfile={FONT}:textfile={t1}:fontcolor=white:fontsize={title_size}:x=(w-text_w)/2:y=(h/2)-70,"
         f"drawtext=fontfile={FONT_REGULAR}:textfile={t2}:fontcolor=0xc9cfe6:fontsize={subtitle_size}:x=(w-text_w)/2:y=(h/2)+30,{fade}", *ENC, f"{name}.mp4"])


def wrap(text, width=24):
    lines, current = [], ""
    for word in text.split():
        if len(current) + len(word) + 1 > width:
            lines.append(current)
            current = word
        else:
            current = f"{current} {word}".strip()
    lines.append(current)
    return "\n".join(lines)


marks = json.load(open(os.path.join(OUT, "marks.json")))
d, p = marks["desktop"], marks["phone"]

# ---- desktop: captions as a lower third
d0 = d["shown"] + 0.3
desktop = [
    (d0, d["loaded"], 1.0, "The middle garment starts open; the others hang edge-on"),
    (d["sweepRightStart"], d["sweepRightEnd"], 1.5, "Hover: the garment under the pointer swings front-on and its neighbours slide aside"),
    (d["sweepRightEnd"], d["sweepLeftStart"], 1.0, "Springs and a pendulum: garments overshoot, settle and sway like clothes on hangers"),
    (d["sweepLeftStart"], d["sweepLeftEnd"], 1.8, "Springs and a pendulum: garments overshoot, settle and sway like clothes on hangers"),
    (d["sweepLeftEnd"], d["returned"], 1.0, "Move away and the rack returns to the middle garment"),
    (d["returned"], d["end"], 1.0, "Click a garment to select it"),
]
dt, timeline = scene(os.path.join(OUT, "desktop.webm"), desktop, "scale=1280:720", "desk")
draw = []
for i, (a, b, caption) in enumerate(timeline):
    f = textfile(f"desk_cap{i}.txt", wrap(caption, 56))
    draw.append(f"drawtext=fontfile={FONT}:textfile={f}:fontcolor=white:fontsize=30:line_spacing=8:box=1:boxcolor=0x1b2030@0.78:boxborderw=16:x=(w-text_w)/2:y=h-text_h-44:enable='between(t,{a:.2f},{b - 0.05:.2f})'")
run(["ffmpeg", "-y", "-v", "error", "-i", "desk_raw.mp4", "-vf", ",".join(draw) + f",fade=t=in:st=0:d=0.4,fade=t=out:st={dt - 0.4:.2f}:d=0.4", *ENC, "desk.mp4"])

# ---- phone: the phone on the left, captions on the right
p0 = p["shown"] + 0.3
phone = [
    (p0, p["dragRightStart"], 1.0, "On a phone the whole rack fits the screen"),
    (p["dragRightStart"], p["swipeLeftEnd"], 1.0, "Drag a finger across the rack to browse: the garment under your finger opens"),
    (p["swipeLeftEnd"], p["tap"] - 0.2, 1.0, "Drag a finger across the rack to browse: the garment under your finger opens"),
    (p["tap"] - 0.2, p["end"], 1.0, "Tap a garment to select it"),
]
pt, timeline = scene(os.path.join(OUT, "phone.webm"), phone, "scale=-2:660", "ph")
draw = []
for i, (a, b, caption) in enumerate(timeline):
    f = textfile(f"ph_cap{i}.txt", wrap(caption, 27))
    draw.append(f"drawtext=fontfile={FONT}:textfile={f}:fontcolor=white:fontsize=40:line_spacing=14:x=640:y=(h-text_h)/2:enable='between(t,{a:.2f},{b - 0.05:.2f})'")
run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c={BG}:s=1280x720:r=30:d={pt:.2f}", "-i", "ph_raw.mp4", "-filter_complex",
     "[0:v][1:v]overlay=x=150:y=30:shortest=1," + ",".join(draw) + f",fade=t=in:st=0:d=0.4,fade=t=out:st={pt - 0.4:.2f}:d=0.4[v]", "-map", "[v]", *ENC, "phone_scene.mp4"])

# ---- cards, final cut, GIF and poster
card("title", "Clothing banner", "Garments that hang and swing like they would on a real rack", 3.0)
card("end", "Hover on desktop. Drag and tap on phones.", "React, plain CSS, spring physics. No animation library.", 3.0, title_size=46)
with open(os.path.join(OUT, "final.txt"), "w") as f:
    f.write("".join(f"file '{x}'\n" for x in ["title.mp4", "desk.mp4", "phone_scene.mp4", "end.mp4"]))
os.makedirs(DOCS, exist_ok=True)
final = os.path.join(DOCS, "how-it-works.mp4")
run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "final.txt", "-c", "copy", "-movflags", "+faststart", final])
run(["ffmpeg", "-y", "-v", "error", "-ss", "4", "-i", final, "-frames:v", "1", os.path.join(DOCS, "poster.jpg")])
# the GIF is the desktop scene only, small enough to sit inline in the README
run(["ffmpeg", "-y", "-v", "error", "-i", "desk.mp4", "-t", "24", "-vf", "fps=10,scale=640:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=5", os.path.join(DOCS, "how-it-works.gif")])
print("wrote", final)
