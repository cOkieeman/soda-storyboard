"""Phase 0: quick MOSS whole-page layout check via raw ComfyUI API (SFT INT8, 25 steps er_sde)."""
import json, sys, time, uuid, urllib.request, pathlib
from PIL import Image

HOST = "http://127.0.0.1:8190"
OUT_JSON = pathlib.Path(sys.argv[1])  # where to store the layout JSONs
COMFY_OUT = pathlib.Path(r"F:/soda comfyui/ComfyUI_windows_portable/ComfyUI/output")
OUT_JSON.mkdir(parents=True, exist_ok=True)
W, H = 1024, 1536
NEG = "worst quality, low quality, blurry, jpeg artifacts, watermark, signature, bad anatomy, bad hands, extra fingers, deformed"
LORA = {
    "sylvia": "MOSS-Image\\character\\SylviaMOSS.safetensors",
    "whale": "MOSS-Image\\character\\mossE9B2B8E9B1BCE5A8.Yqn2.safetensors",
}


def bbox(x1, y1, x2, y2, w=W, h=H):
    """Top-left pixel rect -> MOSS yxyx, centre origin."""
    return [y1 - h // 2, x1 - w // 2, y2 - h // 2, x2 - w // 2]


def layout(caption, items):
    return {
        "summary": {"meta": ["comic", "manga", "multi_panel"], "canvas": "multi_panel", "caption": caption},
        "items": [{"label": l, "caption": c, "bbox": bbox(*r)} for l, c, r in items],
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }


STYLE = ("A black-and-white Japanese manga page, read right to left, panels separated by clean white gutters, "
         "crisp ink line art, screentone shading. ")

# 4 panels, RTL: top wide, middle right, middle left, bottom wide
P1, P2, P3, P4 = (16, 16, 1008, 496), (520, 512, 1008, 1008), (16, 512, 504, 1008), (16, 1024, 1008, 1520)


def page_single(who):
    return layout(
        STYLE + f"Four panels: {who} at a rainy train station turns back and hesitates before boarding.",
        [
            ("object", f"Panel 1, long shot: a rainy train station platform at dusk, {who} seen from behind walking toward the open train door.", P1),
            ("object", f"Panel 2, medium close-up: {who} stops at the train door and turns her head back over her shoulder.", P2),
            ("object", f"Panel 3, extreme close-up of {who}'s eyes, hesitant expression, rain drops.", P3),
            ("text", "A white vertical speech bubble with Chinese text \"那个……\"", (40, 540, 180, 760)),
            ("object", f"Panel 4, medium shot: {who} gives a faint sad smile inside the train doorway.", P4),
            ("text", "A white vertical speech bubble with Chinese text \"没什么。再见。\"", (60, 1050, 260, 1300)),
        ],
    )


GIRL = "a young woman with long black hair in a school uniform"
TWO_TOP, TWO_R, TWO_L = (16, 16, 1008, 752), (520, 768, 1008, 1520), (16, 768, 504, 1520)
PAGE_TWO = layout(
    STYLE + "Three panels: Sylvia and 鲸鱼娘 chatting at a cafe table.",
    [
        ("object", "Panel 1, medium shot: Sylvia on the right and 鲸鱼娘 on the left sitting across a cafe table, talking.", TWO_TOP),
        ("object", "Panel 2, close-up of Sylvia smiling.", TWO_R),
        ("object", "Panel 3, close-up of 鲸鱼娘 laughing.", TWO_L),
    ],
)


def post(path, data, raw=False, headers=None):
    req = urllib.request.Request(HOST + path, data=data if raw else json.dumps(data).encode(), headers=headers or {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def run(prompt, label):
    pid = post("/prompt", {"prompt": prompt, "client_id": "phase0"})["prompt_id"]
    t0 = time.time()
    while True:
        time.sleep(3)
        h = json.load(urllib.request.urlopen(f"{HOST}/history/{pid}", timeout=30))
        if pid in h:
            st = h[pid]["status"]
            imgs = [i for o in h[pid]["outputs"].values() for i in o.get("images", [])]
            print(label, st["status_str"], round(time.time() - t0, 1), "s", [i["filename"] for i in imgs], flush=True)
            if st["status_str"] != "success":
                print(json.dumps(st["messages"][-1], ensure_ascii=False)[:800])
            return imgs


def base_graph(loras):
    g = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "MOSS-Image\\MOSS-Image-SFT\\moss_image_sft_int8_convrot.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3.5_9b_w4a8_gptq.safetensors", "type": "moss_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
    }
    model = ["1", 0]
    for i, (name, s) in enumerate(loras):
        nid = f"L{i}"
        g[nid] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": model, "lora_name": LORA[name], "strength_model": s}}
        model = [nid, 0]
    g["4"] = {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": model, "shift": 5}}
    return g


def t2i(layout_json, seed, prefix, loras=()):
    g = base_graph(loras)
    g.update({
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": json.dumps(layout_json, ensure_ascii=False), "clip": ["2", 0]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["2", 0]}},
        "7": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["4", 0], "seed": seed, "steps": 25, "cfg": 2.5, "sampler_name": "er_sde", "scheduler": "simple", "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["7", 0], "denoise": 1}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": f"MOSS/phase0/{prefix}"}},
    })
    return run(g, prefix)


def upload(path):
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{path.name}\"\r\nContent-Type: image/png\r\n\r\n").encode() + path.read_bytes() + f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n".encode()
    return post("/upload/image", body, raw=True, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})["name"]


def redraw(src_png, rect, caption, denoise, prefix, seed=7):
    crop = Image.open(src_png).convert("RGB").crop(rect)
    scale = 1024 / crop.width
    tw, th = 1024, round(crop.height * scale / 16) * 16
    tmp = OUT_JSON / f"{prefix}_crop.png"
    crop.save(tmp)
    name = upload(tmp)
    g = base_graph(())
    g.update({
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": caption, "clip": ["2", 0]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["2", 0]}},
        "11": {"class_type": "LoadImage", "inputs": {"image": name}},
        "12": {"class_type": "ImageScale", "inputs": {"image": ["11", 0], "upscale_method": "lanczos", "width": tw, "height": th, "crop": "disabled"}},
        "13": {"class_type": "VAEEncode", "inputs": {"pixels": ["12", 0], "vae": ["3", 0]}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["4", 0], "seed": seed, "steps": 25, "cfg": 2.5, "sampler_name": "er_sde", "scheduler": "simple", "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["13", 0], "denoise": denoise}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": f"MOSS/phase0/{prefix}"}},
    })
    return run(g, prefix)


if __name__ == "__main__":
    single = page_single(GIRL)
    sylvia = page_single("Sylvia")
    for name, j in [("T1_layout_text", single), ("T2_sylvia", sylvia), ("T3_two_chars", PAGE_TWO)]:
        (OUT_JSON / f"{name}.json").write_text(json.dumps(j, ensure_ascii=False, indent=2), encoding="utf-8")
    t1 = [t2i(single, s, f"T1_layout_text_s{s}") for s in (101, 102)]
    for s in (101, 102):
        t2i(sylvia, s, f"T2_sylvia_s{s}", loras=[("sylvia", 0.8)])
    for s in (101, 102):
        t2i(PAGE_TWO, s, f"T3_two_chars_s{s}", loras=[("sylvia", 0.7), ("whale", 0.7)])
    src = COMFY_OUT / t1[0][0]["subfolder"] / t1[0][0]["filename"]
    cap = STYLE + f"A single manga panel, extreme close-up of {GIRL}'s eyes, hesitant expression, rain drops, detailed ink line art."
    for d in (0.45, 0.65):
        redraw(src, P3[:2] + (P3[2], P3[3]), cap, d, f"T4_redraw_panel3_d{int(d*100)}")
