"""
create_zenitsu_gif.py
Creates two premium animated Zenitsu-themed GIFs (welcome & ticket banners)
using Pillow + numpy, stores them in the local SQLite database, then uploads.
"""

import sqlite3, base64, math, os, struct, zlib
from pathlib import Path

# ── Try Pillow ──────────────────────────────────────────────────────────────
try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False
    print("Pillow not found. Attempting install…")
    import subprocess, sys
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'Pillow'])
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    HAS_PILLOW = True

import io

DB_PATH = Path(__file__).parent.parent / 'data' / 'zenitsu.db'
GUILD_IDS = ['1444533392518680719', '1445422164814729249']

W, H = 600, 200   # banner size

def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def make_zenitsu_banner_frames(text_top, text_bottom, n_frames=16):
    """Generate n_frames of a premium yellow/gold lightning-themed banner."""
    frames = []
    # Color palette: deep black → gold → bright yellow lightning
    bg_dark   = (12,  8,  2)
    gold_mid  = (200, 140, 0)
    gold_hi   = (255, 210, 20)
    white     = (255, 255, 255)
    
    try:
        font_big   = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 28)
        font_small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf",   16)
    except Exception:
        font_big   = ImageFont.load_default()
        font_small = ImageFont.load_default()

    for i in range(n_frames):
        t = i / n_frames             # 0..1
        pulse = (math.sin(t * 2 * math.pi) + 1) / 2   # 0..1

        img = Image.new('RGB', (W, H), bg_dark)
        draw = ImageDraw.Draw(img)

        # ── Background gradient ───────────────────────────────────────────────
        for y in range(H):
            yt = y / H
            c = lerp_color(bg_dark, (30, 18, 0), yt)
            draw.line([(0, y), (W, y)], fill=c)

        # ── Animated lightning bolts ──────────────────────────────────────────
        import random
        rng = random.Random(i * 7 + 42)   # deterministic per frame
        n_bolts = 3 + int(pulse * 4)
        for _ in range(n_bolts):
            bx = rng.randint(10, W - 10)
            by_top = rng.randint(0, H // 3)
            segments = rng.randint(4, 8)
            cx, cy = bx, by_top
            alpha = int(100 + pulse * 155)
            bolt_col = (255, 220, 30)
            for _ in range(segments):
                nx = cx + rng.randint(-20, 20)
                ny = cy + rng.randint(10, 30)
                ny = min(ny, H)
                draw.line([(cx, cy), (nx, ny)], fill=bolt_col, width=2)
                cx, cy = nx, ny

        # ── Glowing left bar ─────────────────────────────────────────────────
        bar_col = lerp_color(gold_mid, gold_hi, pulse)
        draw.rectangle([(0, 0), (6, H)], fill=bar_col)

        # ── Text ─────────────────────────────────────────────────────────────
        text_glow = lerp_color(gold_mid, white, pulse * 0.6)
        # Shadow
        draw.text((22, 27), text_top,    font=font_big,   fill=(0,0,0))
        draw.text((22, 67), text_bottom, font=font_small, fill=(0,0,0))
        # Main text
        draw.text((20, 25), text_top,    font=font_big,   fill=text_glow)
        draw.text((20, 65), text_bottom, font=font_small, fill=gold_hi)

        # ── Zenitsu kanji watermark (top-right) ──────────────────────────────
        draw.text((W - 55, 10), "善逸", font=font_big, fill=(60, 45, 0))

        frames.append(img)

    return frames


def frames_to_gif_bytes(frames, duration_ms=80):
    buf = io.BytesIO()
    frames[0].save(
        buf,
        format='GIF',
        save_all=True,
        append_images=frames[1:],
        loop=0,
        duration=duration_ms,
        optimize=False,
    )
    return buf.getvalue()


def store_gif(db_path, guild_ids, welcome_gif, ticket_gif):
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()

    import json

    w_b64 = base64.b64encode(welcome_gif).decode()
    t_b64 = base64.b64encode(ticket_gif).decode()

    for gid in guild_ids:
        cur.execute('INSERT OR REPLACE INTO guild_config VALUES (?,?,?)', (gid, 'welcomeFileMime', json.dumps('image/gif')))
        cur.execute('INSERT OR REPLACE INTO guild_config VALUES (?,?,?)', (gid, 'welcomeFileData', json.dumps(w_b64)))
        cur.execute('INSERT OR REPLACE INTO guild_config VALUES (?,?,?)', (gid, 'ticketFileMime',  json.dumps('image/gif')))
        cur.execute('INSERT OR REPLACE INTO guild_config VALUES (?,?,?)', (gid, 'ticketFileData',  json.dumps(t_b64)))
        # Remove plain URL fallbacks
        cur.execute("DELETE FROM guild_config WHERE guild_id=? AND key='welcomeImage'", (gid,))
        cur.execute("DELETE FROM guild_config WHERE guild_id=? AND key='ticketImage'",  (gid,))
        print(f"  [OK] Guild {gid}: welcome={len(w_b64)//1024}KB  ticket={len(t_b64)//1024}KB")

    con.commit()
    con.close()


def main():
    print("Generating WELCOME banner frames…")
    w_frames = make_zenitsu_banner_frames(
        "⚡ ZENITSU LIVE",
        "Welcome to the server! Prepare to witness Thunder Breathing."
    )
    print("Generating TICKET banner frames…")
    t_frames = make_zenitsu_banner_frames(
        "🎫 ZENITSU SECURITY SYSTEM",
        "Open a ticket for support, purchases, or inquiries."
    )

    print("Encoding to GIF…")
    w_gif = frames_to_gif_bytes(w_frames, duration_ms=80)
    t_gif = frames_to_gif_bytes(t_frames, duration_ms=80)

    print(f"  Welcome GIF: {len(w_gif)//1024} KB")
    print(f"  Ticket  GIF: {len(t_gif)//1024} KB")


    # Save previews for inspection
    out_dir = Path(__file__).parent
    with open(out_dir / 'preview_welcome.gif', 'wb') as f: f.write(w_gif)
    with open(out_dir / 'preview_ticket.gif',  'wb') as f: f.write(t_gif)
    print("  Preview GIFs saved: scripts/preview_welcome.gif & scripts/preview_ticket.gif")

    print(f"\nStoring in database: {DB_PATH}")
    store_gif(DB_PATH, GUILD_IDS, w_gif, t_gif)

    print("\n✅ Done! Run the HF upload script next:")
    print('  python "C:/Users/Admin/.gemini/antigravity/brain/87f2982f-fee1-422a-aaf1-d7830a17a1aa/scratch/upload_db_via_hflib.py"')


if __name__ == '__main__':
    main()
