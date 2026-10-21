"""Hand-written pudding page in the style of the user's good example (character hero item, sized vertical text boxes with text field, rich English captions)."""
import json, sys, pathlib
from PIL import Image, ImageDraw, ImageFont

sys.argv = [sys.argv[0], sys.argv[1]]
import phase0 as p0  # noqa: E402

OUT = pathlib.Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1024, 1536
SIS = ("the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, "
       "thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest")
KID = ("the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, "
       "rosy cheeks, an oversized bright yellow hoodie with the hood down")


def bb(x1, y1, x2, y2):
    return [y1 - H // 2, x1 - W // 2, y2 - H // 2, x2 - W // 2]


def obj(caption, rect, label="object"):
    return {"label": label, "caption": caption, "bbox": bb(*rect)}


def txt(caption, text, rect):
    return {"label": "text", "caption": caption, "text": text, "bbox": bb(*rect)}


layout = {
    "summary": {
        "meta": ["comic", "multi_panel", "digital_painting"],
        "canvas": "multi_panel",
        "caption": (
            "High-taste, fully colored 2D anime digital painting comic page in Japanese manga layout, read right to left, "
            "clean white gutters, crisp clean line art with soft cel shading and gentle painterly highlights, "
            "bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, "
            "expressive comedic facial expressions, crisp Chinese comic text in clean white speech bubbles and narration boxes, "
            "zero rough sketch lines, 2girls, sisters, home kitchen, open refrigerator, pudding cup, slapstick comedy."
        ),
    },
    "items": [
        obj(f"Top-right panel: inside a bright home kitchen at night snack time, {KID} crouches in front of the open refrigerator, "
            "happily eating a caramel pudding cup with a small spoon, the fridge light glowing on her face.", (520, 24, 1000, 500)),
        obj(f"Top-left panel: {SIS} stands frozen in the kitchen doorway, one hand still on the door frame, "
            "her glasses glinting, staring at the empty pudding shelf in disbelief.", (24, 24, 500, 500)),
        obj(f"Main center character focus breaking across the middle panels: {KID} turns around in total panic, "
            "caramel pudding smeared at the corner of her lips, eyes wide with sweat drops, both hands raised and waving "
            "defensively while hiding the empty pudding cup behind her back.", (220, 470, 800, 1190), label="character"),
        obj(f"Middle-right small vertical panel: low-angle close-up of {SIS} pushing up her glasses with one finger, "
            "a cold, thin smile, a dark aura behind her as she slowly steps forward.", (740, 540, 1000, 1080)),
        obj("Middle-left small vertical panel: extreme close-up of an empty caramel pudding cup with a tiny spoon "
            "lying on the kitchen counter, a little label written 'sister's' on the lid.", (24, 540, 280, 1080)),
        obj(f"Bottom wide panel: comedic chase, {KID} bursts out of the frame to the left with her pink twin tails "
            f"and hoodie strings flying straight up in fright, speed lines behind her; {SIS} chases from the right, "
            "glasses flashing white.", (24, 1210, 1000, 1512)),
        txt("Clean vertical Chinese narration text in a white narration box on the right edge of the top-right panel.",
            "冰箱里的布丁\n是姐姐的宝贝", (920, 44, 990, 330)),
        txt("Bold comic sound effect text near the pudding cup in the top-right panel.", "吧唧", (560, 380, 660, 470)),
        txt("Clean vertical Chinese dialogue text in a white speech bubble next to the older sister in the top-left panel.",
            "……你在吃什么？", (40, 50, 110, 330)),
        txt("Clean vertical Chinese dialogue text in a jagged panicked speech bubble beside the younger sister's head.",
            "是……是冰箱\n自己打开的！", (250, 500, 370, 780)),
        txt("Clean vertical Chinese dialogue text in a small white speech bubble at the top of the middle-right panel.",
            "哦？", (920, 560, 990, 680)),
        txt("Large bold comic sound effect text with speed lines in the bottom panel.", "咻——！", (60, 1230, 280, 1320)),
        txt("Clean vertical Chinese dialogue text in an angry speech bubble near the older sister in the bottom panel.",
            "站住！", (900, 1225, 980, 1400)),
    ],
    "bbox_coord_space": "abs_centralized",
    "bbox_format": "yxyx",
}
(OUT / "pudding-example-style.moss.json").write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding="utf-8")

MODELS = {
    "base": "MOSS-Image\\MOSS-Image-Base\\moss_image_base_int8_convrot.safetensors",
    "sft": "MOSS-Image\\MOSS-Image-SFT\\moss_image_sft_int8_convrot.safetensors",
}


def t2i(model, seed=302):
    g = p0.base_graph(())
    g["1"]["inputs"]["unet_name"] = MODELS[model]
    g["4b"] = {"class_type": "SkipLayerGuidanceDiTSimple", "inputs": {"model": ["4", 0], "double_layers": "", "single_layers": "22", "start_percent": 0, "end_percent": 1}}
    g.update({
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": json.dumps(layout, ensure_ascii=False), "clip": ["2", 0]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": p0.NEG, "clip": ["2", 0]}},
        "7": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["4b", 0], "seed": seed, "steps": 50, "cfg": 3, "sampler_name": "euler", "scheduler": "simple", "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["7", 0], "denoise": 1}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": f"MOSS/plugin-test/example_style_{model}_s{seed}"}},
    })
    imgs = p0.run(g, f"example_style_{model}")
    return p0.COMFY_OUT / imgs[0]["subfolder"] / imgs[0]["filename"]


def sketch():
    """Wireframe in the example's colour code: cyan panels, red character, green text."""
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
    for it in layout["items"]:
        y1, x1, y2, x2 = it["bbox"]
        r = (x1 + W // 2, y1 + H // 2, x2 + W // 2, y2 + H // 2)
        color = {"object": (0, 200, 230), "character": (230, 40, 30), "text": (40, 180, 70)}[it["label"]]
        d.rectangle(r, outline=color, width=4)
        if it["label"] == "text":
            d.text((r[0] + 4, r[1] + 4), it["text"].replace("\n", " / "), fill=color, font=font)
    path = OUT / "pudding-example-style.sketch.png"
    im.save(path)
    return path


if __name__ == "__main__":
    print("sketch", sketch())
    for m in ("base", "sft"):
        print(m, t2i(m))
