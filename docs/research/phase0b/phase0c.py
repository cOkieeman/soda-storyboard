"""Phase 0c: rerun 0b redraws with single-frame prompts (0b captions said 'manga page with panels' and MOSS drew a mini page inside each crop)."""
import sys, pathlib
from PIL import Image

sys.argv = [sys.argv[0], sys.argv[1]]
import phase0 as p0  # noqa: E402
import phase0b as pb  # noqa: E402

FRAME = ("A single black-and-white manga illustration, one frame only, no panel borders, no gutters, "
         "no text, no speech bubbles, crisp ink line art, screentone shading. ")
PAGE = p0.COMFY_OUT / "MOSS" / "phase0" / "B1_page_sylvia_only_00001_.png"
WHALE = ("whale", 0.8)

if __name__ == "__main__":
    p3 = pb.prep(PAGE, pb.LEFT, False, "C2_panel3_crop")
    cap3 = FRAME + "Close-up of 鲸鱼娘 laughing."
    r3 = {d: pb.i2i(p3, cap3, d, f"C2_panel3_whale_d{int(d*100)}", WHALE, False) for d in (0.75, 0.85)}

    p1 = pb.prep(PAGE, pb.TOP, True, "C3_panel1_crop_leftmask")
    cap1 = FRAME + "Medium shot: 鲸鱼娘 sitting on the left side of a cafe table, talking, facing right."
    r1 = {d: pb.i2i(p1, cap1, d, f"C3_panel1_inpaint_left_whale_d{int(d*100)}", WHALE, True) for d in (0.85, 0.95)}

    comp = Image.open(PAGE).convert("RGB")
    for rect, src in ((pb.LEFT, r3[0.85]), (pb.TOP, r1[0.95])):
        im = Image.open(src).convert("RGB").resize((rect[2] - rect[0], rect[3] - rect[1]), Image.LANCZOS)
        comp.paste(im, rect[:2])
    dst = p0.COMFY_OUT / "MOSS" / "phase0b" / "C4_composite_page.png"
    comp.save(dst)
    print("composite", dst)
