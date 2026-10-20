"""Phase 0d: can MOSS draw slanted (diagonal) gutters on its own from a whole-page layout?"""
import json, sys

sys.argv = [sys.argv[0], sys.argv[1]]
import phase0 as p0  # noqa: E402

STYLE = ("A black-and-white Japanese manga page, read right to left, crisp ink line art, screentone shading. "
         "The top row is split into three panels by two DIAGONAL slanted gutters (tilted white lines, not vertical); "
         "below are two full-width horizontal panels. No text, no speech bubbles. ")
GIRL = "a young woman with long black hair in a school uniform"
# Top row approximated by midline rectangles (slanted cuts lean right by ~60px from top to bottom)
ITEMS = [
    ("object", f"Top-right slanted panel: {GIRL} raising her arm, medium shot.", (700, 16, 1008, 520)),
    ("object", f"Top-middle slanted panel: {GIRL} turning her head, close-up.", (360, 16, 680, 520)),
    ("object", f"Top-left slanted panel: {GIRL} closing her eyes, close-up.", (16, 16, 340, 520)),
    ("object", f"Middle wide panel: extreme close-up of {GIRL}'s eyes and face, lying down.", (16, 536, 1008, 1024)),
    ("object", f"Bottom wide panel: {GIRL} leaning on a balcony railing at night, city lights behind.", (16, 1040, 1008, 1520)),
]

if __name__ == "__main__":
    page = p0.layout(STYLE, ITEMS)
    (p0.OUT_JSON / "D1_slanted.json").write_text(json.dumps(page, ensure_ascii=False, indent=2), encoding="utf-8")
    for s in (201, 202):
        p0.t2i(page, s, f"../phase0d/D1_slanted_s{s}")
