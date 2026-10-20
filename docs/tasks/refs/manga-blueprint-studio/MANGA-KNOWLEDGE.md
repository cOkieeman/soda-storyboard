# Manga Knowledge Base — Human + AI shared reference

This document is the shared conceptual vocabulary for humans and AI agents using Manga Blueprint Studio.

It explains **what manga structure means before prescribing coordinates**. Humans may use it to choose and request techniques. AI should use it to translate story intent into semantic Name DSL / Executable Name constraints.

> Rule: medium requirements are constraints; genre recommendations are heuristics; author direction wins.

## 1. Manga basics

A manga page is not merely a collection of pictures. It controls four things at once:

1. **Information** — what the reader learns.
2. **Attention** — what the reader notices first/next.
3. **Time** — how long a moment feels.
4. **Emotion / impact** — how strongly a beat lands.

Useful hierarchy:

```text
work / episode
  → page or scroll sequence
    → beat (story event)
      → panel (visible unit)
        → attention target
          → camera / pose / gaze / motion / lettering
```

For Japanese page manga, default reading flow is right-to-left and top-to-bottom. Do not assume that every medium uses this: vertical-scroll comics primarily use top-to-bottom progression.

### Panel is a timing device

Panel size is not a universal importance score. A large panel can create spectacle or a long hold; a tiny panel can create a sharp, important instant. Judge it relative to neighboring panels.

### The basic beat chain

A readable action often separates:

```text
setup → anticipation → action/contact → reaction/result
```

Dialogue scenes often use:

```text
speaker → listener reaction → new information → reaction / pause
```

Do not mechanically create all stages. Omission itself can create speed or surprise.

## 2. Page size and manuscript vocabulary

Physical page dimensions and digital pixel dimensions are different concepts.

### Common physical sizes

| Name | Finished size | Typical use |
|---|---:|---|
| B5 | 182 × 257 mm | common Japanese doujin/manga book size |
| A5 | 148 × 210 mm | compact books/doujin |
| B6 | 128 × 182 mm | common collected-book scale |
| A4 | 210 × 297 mm | documents / some digital workflows |
| B4 | 257 × 364 mm | traditional commercial manga manuscript scale |

For print, always follow the printer/publisher template when one exists. Commercial submission conventions often use B4 manuscript templates; doujin workflows commonly start from the intended finished-book size. Monochrome manga is commonly authored at 600 dpi; color commonly at roughly 300–350 dpi.

### Manuscript boundaries

- **trim / 仕上がり線** — final cut edge.
- **bleed / 塗り足し** — artwork extending outside trim so cutting does not reveal white edges.
- **safe area / 内枠** — important faces/dialogue should normally remain comfortably inside this area.
- **gutter / ノド** — bound inner edge. Avoid critical details here.
- **outer edge / 小口** — outer edge opposite the gutter.
- **crop marks / トンボ** — print cutting/alignment guides.

AI rule: never infer exact bleed/safe-area millimeters when a publisher/printer template is available. Treat the supplied production template as authority.

## 3. Medium profiles

These are starting profiles, not universal rules. Platform/publisher requirements override them.

### Printed / page manga

- Shape: portrait page, commonly B5/A5/B6 finished formats.
- Reading: Japanese manga normally RTL.
- Typical working density: **roughly 3–7 panels/page**, with 4–6 a useful neutral starting point.
- Fewer panels: spectacle, pause, emotional weight, large establishing image.
- More panels: rapid reactions, dense dialogue, procedural detail, compressed time.
- Use page turn, spread, gutter and trim intentionally.

### Web page manga / pixiv-style multi-page posting

- Preserve page composition; optimize export for screens.
- pixiv currently recommends about **1700 px wide × 2400 px high** for a B5-derived page and a 2400 px long side.
- Typical panel density can remain close to print manga, but small lettering/detail must survive phone display.

### Vertical-scroll / webtoon-style

- Reading: top-to-bottom.
- Think in **vertical beats and spacing**, not printed pages.
- A historical WEBTOON CANVAS upload format uses slices up to 800 × 1280 px; current platform rules should be checked before export.
- Panel count is better considered per episode than per page. Episode length varies heavily; do not encode one universal count.
- Large vertical whitespace creates pause, suspense, scale or scene separation.
- Avoid relying on page-turn reveals; use scroll-distance reveals instead.

### Social-media short manga

- Usually optimize for phone legibility and immediate comprehension.
- 1-page, 2–4 panel, or short carousel structures are common practical choices, not platform laws.
- Favor fewer attention targets and larger lettering than print-density pages.

## 4. Genre / scene heuristics

Genre does not force a layout. Use these as candidate biases.

| Genre / scene | Useful starting techniques | Why |
|---|---|---|
| Action / battle | diagonal panels, strong foreground/background depth, motion lines, contact focus, low angle, large climax panel | direction, velocity, impact |
| Comedy | regular setup panels, reaction close-up, pause panel, abrupt size contrast | timing and punchline clarity |
| Romance | close-ups, eye/hand inserts, soft pauses, gaze chains, spacious panels | subtle emotion and relationship distance |
| Horror / suspense | negative space, slow reveal, cropped information, high/odd angles, page/scroll reveal | uncertainty and delayed information |
| Mystery | inserts of clues, controlled attention, establishing geography, reaction shots | information hierarchy |
| Slice of life | medium shots, establishing panels, quiet holds, stable grids | readability and atmosphere |
| Sports | motion direction, anticipation→impact→result, wide geography, close-up inserts | position + physical causality |
| Drama | reaction shots, close-ups, silence, panel-size contrast | emotional priority |
| Exposition / tutorial | stable grid, clear reading path, inserts, moderate camera changes | comprehension |

AI rule: infer **purpose first**, genre second. A romance fight scene may need action grammar; an action manga conversation may need quiet dialogue grammar.

## 5. Camera / composition terminology

### Distance

- **extreme long shot / extreme wide** — environment dominates; geography and scale.
- **long shot / ロング / 引き** — full body plus surroundings; relationship/position.
- **medium shot** — roughly waist/chest region and above depending framing; balances gesture and expression.
- **close-up / 寄り / アップ** — subject fills frame; directs attention to emotion/detail.
- **extreme close-up / 超寄り / 超アップ** — eye, mouth, hand, object detail; very strong selective attention.

**寄る** means moving the framing closer to the subject. **引く** means widening/moving away to show more context. These are relative instructions, not fixed focal lengths.

### Angle

- **eye level** — neutral-height viewpoint.
- **low angle / あおり** — camera looks upward; can emphasize scale, power, pressure.
- **high angle / 俯瞰** — camera looks downward; useful for geography, vulnerability or overview depending context.
- **bird's-eye / 真俯瞰** — near-direct overhead view.
- **Dutch angle / 傾き** — tilted horizon; instability, speed or abnormality.
- **POV / 主観** — camera approximates a character's viewpoint.
- **over-the-shoulder** — foreground shoulder/head frames another subject; relationship/conversation geography.

### Composition terms

- **foreground / 前景** — closest visual layer.
- **midground / 中景** — middle depth layer.
- **background / 背景** — far layer/environment.
- **silhouette** — readable outer shape of a subject.
- **negative space / 余白** — intentionally empty visual area.
- **eye line / 視線** — direction a character appears to look.
- **leading line / 誘導線** — visual line guiding reader attention.

## 6. Panel and page-direction terminology

- **大ゴマ / hero panel** — relatively large panel used for hold, spectacle, reveal or emphasis.
- **小ゴマ** — small panel; useful for quick beats/details/reactions.
- **斜めコマ** — diagonal boundary; can reinforce motion, collision or instability.
- **断ち切り / bleed panel** — artwork reaches the trim/page edge; expands perceived space.
- **ブチ抜き / breakout** — character/object crosses panel-frame boundaries; emphasizes presence or continuity.
- **小窓 / inset** — smaller panel placed within/over another panel, often for detail/reaction/simultaneity.
- **見開き / spread** — two facing pages treated as one composition.
- **ページめくり / page-turn reveal** — withhold information until the next page becomes visible.
- **間 / hold** — designed reading time or silence; not equivalent to low importance.
- **タチキリ** — common shorthand for art extending to the page trim; production usage may overlap with bleed terminology.

## 7. Motion / action terminology

- **anticipation / 予備動作** — preparation before an action; makes the next movement legible and stronger.
- **impact / 接触・衝突** — decisive contact moment.
- **follow-through** — movement after impact.
- **reaction** — response that communicates the effect of an event.
- **speed lines / 速度線・流線** — indicate movement direction/speed.
- **focus lines / 集中線** — converge attention on a target.
- **motion direction** — dominant vector of movement; useful for aligning gaze, panel diagonals and next-panel entry.

## 8. Lettering terminology

- **speech balloon / 吹き出し** — spoken dialogue container.
- **thought balloon / 思考** — internal thought representation (style varies).
- **narration / caption** — narration or non-spoken text block.
- **SFX / 描き文字・効果音** — sound/impact lettering; part of composition, not merely text metadata.
- **tail / しっぽ** — balloon pointer identifying speaker.
- **vertical writing / 縦書き** — common Japanese manga lettering direction.

Visible-text rule for AI generation: only explicitly authored dialogue/narration/SFX should be rendered. Never render IDs, camera notes, contact labels or solver annotations.

## 9. Human → AI direction pattern

Humans should be able to request manga direction in ordinary language:

```text
最後は大ゴマ。
主人公に寄る。
敵の剣との接触を一番見せたい。
右上から左下へ視線を流したい。
その前に一コマ「間」を入れる。
```

AI translates the request into semantics before geometry:

```yaml
purpose: climax
importance:
  narrative: high
  visual: climax
hold: medium
camera: close
attention:
  primary: swords.contact
flow:
  entry: top-right
  exit: bottom-left
```

Named techniques may become explicit constraints when the human names them (`大ゴマ`, `斜めコマ`, `ブチ抜き`, etc.). Otherwise they are candidates selected from intent.

## 10. AI reasoning contract

When designing a page:

1. Identify medium and reading direction.
2. Identify each beat's story purpose.
3. Determine primary attention target.
4. Determine reading-time/hold separately from importance.
5. Determine gaze and motion vectors where meaningful.
6. Select camera distance/angle from information needs.
7. Consult genre heuristics only as a bias.
8. Propose panel/page techniques that serve those goals.
9. Preserve human-named techniques and hard locks.
10. Compile/solve geometry; do not invent coordinates unless pinned.
11. Explain proposals in terms of intent, not vague aesthetic claims.

### Prompt-oriented output

A downstream image prompt should state observable constraints, for example:

```text
Four-panel Japanese RTL manga page. Final panel is the dominant climax panel.
In panel 4, use a close low-angle view. Fighter A crosses the foreground from right toward lower-left.
Primary attention is the sword-contact region. Preserve the supplied panel boundaries and character silhouettes.
Do not reproduce blueprint annotations or camera labels as visible text.
```

Avoid prompt-only instructions for geometry that already exists in Clean. Clean is the spatial contract; prompt/JSON carries semantics and preservation requirements.

## 11. Source-sensitive facts

Production/export requirements change. Treat current platform/publisher documentation as authoritative at export time.

Current reference points used by this guide:

- pixiv Help: manga posting recommendation — long side 2400 px; B5-derived example around 1700 × 2400 px.
- MediBang beginner manga guidance: commercial submission B4 manuscript template; doujin manuscript at intended book size; monochrome commonly 600 dpi and color around 300–350 dpi.
- WEBTOON/CANVAS historical publishing guidance/examples: 800 px wide × 1280 px upload slices. Verify current WEBTOON requirements before shipping.

The application should distinguish **platform requirement** from **editor recommendation** so stale upload limits never become canonical manga grammar.
