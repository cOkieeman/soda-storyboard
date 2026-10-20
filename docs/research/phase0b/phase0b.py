"""Phase 0b: two characters on one page - one LoRA per pass (page with Sylvia, then whale-girl panel redraw / masked inpaint)."""
import json, sys, pathlib
from PIL import Image

sys.argv = [sys.argv[0], sys.argv[1]]
import phase0 as p0  # noqa: E402  (reuses helpers; its __main__ block does not run)

OUT = pathlib.Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
COMFY_OUT = p0.COMFY_OUT
TOP, RIGHT, LEFT = p0.TWO_TOP, p0.TWO_R, p0.TWO_L
STYLE = p0.STYLE
WHALE_DESC = "鲸鱼娘"


def saved(imgs):
    i = imgs[0]
    return COMFY_OUT / i["subfolder"] / i["filename"]


def i2i(png_with_alpha, caption, denoise, prefix, lora, masked, seed=11):
    name = p0.upload(png_with_alpha)
    g = p0.base_graph([lora])
    g.update({
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": caption, "clip": ["2", 0]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": p0.NEG, "clip": ["2", 0]}},
        "11": {"class_type": "LoadImage", "inputs": {"image": name}},
        "13": {"class_type": "VAEEncode", "inputs": {"pixels": ["11", 0], "vae": ["3", 0]}},
    })
    latent = ["13", 0]
    if masked:
        g["14"] = {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["13", 0], "mask": ["11", 1]}}
        latent = ["14", 0]
    g["8"] = {"class_type": "KSampler", "inputs": {"model": ["4", 0], "seed": seed, "steps": 25, "cfg": 2.5, "sampler_name": "er_sde", "scheduler": "simple", "positive": ["5", 0], "negative": ["6", 0], "latent_image": latent, "denoise": denoise}}
    g["9"] = {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}}
    out = ["9", 0]
    if masked:
        g["15"] = {"class_type": "ImageCompositeMasked", "inputs": {"destination": ["11", 0], "source": ["9", 0], "x": 0, "y": 0, "resize_source": False, "mask": ["11", 1]}}
        out = ["15", 0]
    g["10"] = {"class_type": "SaveImage", "inputs": {"images": out, "filename_prefix": f"MOSS/phase0b/{prefix}"}}
    return saved(p0.run(g, prefix))


def prep(page_png, rect, left_half_mask, name):
    """Crop a panel, scale to 1024 wide; when masked, make the left half transparent (= area to repaint)."""
    crop = Image.open(page_png).convert("RGB").crop(rect)
    tw, th = 1024, round(crop.height * 1024 / crop.width / 16) * 16
    crop = crop.resize((tw, th), Image.LANCZOS).convert("RGBA")
    if left_half_mask:
        a = Image.new("L", (tw, th), 255)
        a.paste(0, (0, 0, tw // 2, th))
        crop.putalpha(a)
    path = OUT / f"{name}.png"
    crop.save(path)
    return path


if __name__ == "__main__":
    page = p0.layout(
        STYLE + f"Three panels: Sylvia and {WHALE_DESC} chatting at a cafe table.",
        [
            ("object", f"Panel 1, medium shot: Sylvia on the right and {WHALE_DESC} on the left sitting across a cafe table, talking.", TOP),
            ("object", "Panel 2, close-up of Sylvia smiling.", RIGHT),
            ("object", f"Panel 3, close-up of {WHALE_DESC} laughing.", LEFT),
        ],
    )
    (OUT / "B1_page_sylvia_only.json").write_text(json.dumps(page, ensure_ascii=False, indent=2), encoding="utf-8")
    page_png = saved(p0.t2i(page, 101, "B1_page_sylvia_only", loras=[("sylvia", 0.8)]))

    whale = ("whale", 0.8)
    p3 = prep(page_png, LEFT, False, "B2_panel3_crop")
    cap3 = STYLE + f"A single manga panel, close-up of {WHALE_DESC} laughing, detailed ink line art."
    r3 = {d: i2i(p3, cap3, d, f"B2_panel3_whale_d{int(d*100)}", whale, False) for d in (0.6, 0.75)}

    p1 = prep(page_png, TOP, True, "B3_panel1_crop_leftmask")
    cap1 = STYLE + f"A single manga panel, medium shot: {WHALE_DESC} sitting on the left side of a cafe table, talking."
    r1 = {d: i2i(p1, cap1, d, f"B3_panel1_inpaint_left_whale_d{int(d*100)}", whale, True) for d in (0.75, 0.9)}

    comp = Image.open(page_png).convert("RGB")
    for rect, src in ((LEFT, r3[0.75]), (TOP, r1[0.9])):
        im = Image.open(src).convert("RGB").resize((rect[2] - rect[0], rect[3] - rect[1]), Image.LANCZOS)
        comp.paste(im, rect[:2])
    dst = COMFY_OUT / "MOSS" / "phase0b" / "B4_composite_page.png"
    comp.save(dst)
    print("composite", dst)
