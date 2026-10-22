#!/usr/bin/env python3
"""Prepare a garment photo for ClothingRack.

Input : a photo of a garment on a light-wood hanger, either with a transparent
        background or on a plain white one.
Output: an 800x960 WebP with a transparent background, ready to use as `image`
        (or `sideImage`):
          - the photographed hook is removed (the component draws a chrome hook)
          - the hanger apex sits at (400, 92), so every garment hangs from the same point
          - the wooden hanger is recoloured (dark mahogany by default)
          - a soft drop shadow is baked in, so the page needs no CSS shadow filter

    python tools/prepare-garment.py tee.png tee-front.webp
    python tools/prepare-garment.py tee.png out.webp --hanger none --length 800
    python tools/prepare-garment.py odd.png out.webp --apex-x 512 --apex-y 140

Requires: pip install pillow numpy
"""
from __future__ import annotations

import argparse
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

W, H = 800, 960
APEX_X, APEX_Y = 400, 92
MAHOGANY_DARK = np.array([40, 18, 12], float)
MAHOGANY_LIGHT = np.array([128, 64, 42], float)


def cut_out_white(im: Image.Image, tolerance: int = 14) -> Image.Image:
    """Make a plain white background transparent (flood fill from the border)."""
    rgb = np.array(im.convert("RGB")).astype(int)
    h, w = rgb.shape[:2]
    background = np.abs(rgb - 255).max(axis=2) < tolerance
    seen = np.zeros((h, w), bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if background[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if background[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and background[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    alpha = Image.fromarray(np.where(seen, 0, 255).astype(np.uint8))
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.9))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def wood_mask(a: np.ndarray, limit_rows: int) -> np.ndarray:
    r, g, b, al = (a[..., i].astype(int) for i in range(4))
    rows = np.arange(a.shape[0])[:, None]
    return (al > 40) & (r > 150) & (r - b > 45) & (r - g > 15) & (rows < limit_rows)


def find_apex(im: Image.Image) -> tuple[int, int]:
    a = np.array(im)
    mask = wood_mask(a, max(200, a.shape[0] // 4))
    rows = np.where(mask.any(axis=1))[0]
    if len(rows) == 0:
        raise SystemExit("Could not find a light-wood hanger. Pass --apex-x and --apex-y (the top of the hanger body).")
    y = int(rows[0])
    xs = np.where(mask[min(y + 4, a.shape[0] - 1)])[0]
    return int(xs.mean()), y


def recolour_hanger(a: np.ndarray, mode: str) -> None:
    if mode == "none":
        return
    r, g, b, al = (a[..., i].astype(int) for i in range(4))
    rows = np.arange(a.shape[0])[:, None]
    wood = wood_mask(a, 230)
    near = np.array(Image.fromarray((wood * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
    soft = near & (al > 40) & (r - b > 22) & (r > 95) & (rows < 230)
    m = (wood | soft) & (al > 0)
    if mode == "mahogany":
        dark, light = MAHOGANY_DARK, MAHOGANY_LIGHT
    else:  # a hex colour such as #5a2d1c: dark and light ramps around it
        hexv = mode.lstrip("#")
        base = np.array([int(hexv[i : i + 2], 16) for i in (0, 2, 4)], float)
        dark, light = base * 0.45, np.minimum(base * 1.35, 255)
    lum = ((r + g + b) / 3.0) / 255.0
    t = np.clip((lum - 0.50) / 0.32, 0, 1)[..., None]
    colour = dark + (light - dark) * t
    for c in range(3):
        a[..., c] = np.where(m, colour[..., c], a[..., c])


def bake_shadow(im: Image.Image, offset: int = 25, sigma: float = 16.0, opacity: float = 0.16) -> Image.Image:
    alpha = np.array(im)[..., 3].astype(np.float32) / 255.0
    shifted = np.zeros_like(alpha)
    shifted[offset:] = alpha[: alpha.shape[0] - offset]
    blurred = Image.fromarray((shifted * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma))
    shadow_alpha = np.array(blurred).astype(np.float32) / 255.0 * opacity
    fade = np.clip((alpha.shape[0] - 1 - np.arange(alpha.shape[0])) / 44.0, 0, 1)[:, None]
    shadow_alpha *= fade * fade * (3 - 2 * fade)  # no hard cut-off at the bottom edge
    shadow = np.zeros((*alpha.shape, 4), np.float32)
    shadow[..., 3] = shadow_alpha
    out = Image.fromarray((shadow * 255).astype(np.uint8), "RGBA")
    out.alpha_composite(im)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--hanger", default="mahogany", help="mahogany (default), none, or a hex colour such as #5a2d1c")
    ap.add_argument("--length", type=float, default=830, help="hanger apex to hem, in output pixels (default 830)")
    ap.add_argument("--apex-x", type=int, help="x of the hanger apex in the input, if detection fails")
    ap.add_argument("--apex-y", type=int, help="y of the hanger apex in the input, if detection fails")
    ap.add_argument("--no-shadow", action="store_true", help="skip the baked-in shadow")
    args = ap.parse_args()

    im = Image.open(args.input).convert("RGBA")
    if np.array(im)[..., 3].min() > 250:  # no transparency: assume a plain white background
        im = cut_out_white(im)
    ax, ay = (args.apex_x, args.apex_y) if args.apex_x is not None and args.apex_y is not None else find_apex(im)

    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    hem = box[3]
    scale = min(args.length / max(hem - ay, 1), (W - 20) / max(box[2] - box[0], 1))
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    ax, ay = round(ax * scale), round(ay * scale)

    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.paste(im, (APEX_X - ax, APEX_Y - ay), im)
    a = np.array(canvas)
    a[: APEX_Y - 1, APEX_X - 90 : APEX_X + 90, 3] = 0  # drop the photographed hook
    recolour_hanger(a, args.hanger)
    canvas = Image.fromarray(a)
    if not args.no_shadow:
        canvas = bake_shadow(canvas)
    canvas.save(args.output, "WEBP", quality=88, method=6, alpha_quality=100)
    print(f"{args.input} -> {args.output} (apex found at {ax},{ay}, scale {scale:.2f})")


if __name__ == "__main__":
    main()
