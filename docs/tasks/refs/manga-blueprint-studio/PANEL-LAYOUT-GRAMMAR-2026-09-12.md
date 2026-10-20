# Panel Layout Grammar Research — 2026-09-12

Status: design research / implementation rationale for the Story Template panel-layout refresh.

This note is historical evidence. Current shipped behavior belongs in `docs/PRODUCT.md` and `docs/USER-GUIDE.md`.

## Why this work exists

Generated pages from the earlier `diagonal3` / `diagonal4` presets could look dynamic at the blueprint level but leave large white wedges or a broad central cross after rendering. The problem was structural: each neighboring rectangular cell was skewed independently, so the empty space between two slanted panels expanded instead of behaving like one intentional manga gutter.

The target is not “more diagonal panels.” The target is clearer Japanese RTL reading, stronger visual-weight hierarchy, and less accidental page-background whitespace.

## Sources reviewed

- Shogakukan Newcomer Comic Award, manga training: panel layout
  - https://shincomi.shogakukan.co.jp/training/004.html
- Weekly Shonen Jump Manga Award Portal, Haruichi Furudate interview, vol. 5: panel-size contrast
  - https://www.jump-mangasho.com/interview/furudate-sensei-vol5/
- Oekaki Zukan: manga panel layout / diagonal-panel eye-flow examples
  - https://oekaki-zukan.com/articles/16236
- MediBang Paint beginner manga course: panel layout and page composition
  - https://medibangpaint.com/use/2020/10/beginner-manga-course06-panel-layout/

The implementation also follows the current Tsuzuri Core `comics-creation`, `comics-direction`, and `comics-medium-direction` skills: panel size is visual time/weight, readability precedes deliberate rule-breaking, and a page should not reduce into equally weighted independent illustrations.

## Distilled grammar

### 1. Gutter direction is part of reading order

For Japanese RTL pages, panels inside one tier should visually group more tightly than the gap used to drop into the next tier. A reader should not need panel numbers to decide whether to move horizontally or vertically.

Implementation rule:

- horizontal progression gap (`hGap`) is narrow;
- inter-tier gap (`vGap`) is measurably larger;
- both remain small relative to the working page area.

This converts whitespace from accidental leftovers into a timing / grouping signal.

### 2. Neighboring diagonal panels share one seam

Bad pattern:

```text
independent trapezoid   wide white wedge   independent trapezoid
```

Better pattern:

```text
panel A  / narrow constant gutter /  panel B
```

The two inner edges are parallel and use one constant narrow gap. This prevents the central white `V`, `X`, or cross shape from becoming more visually dominant than the artwork.

### 3. Diagonal cuts need a narrative vector

Diagonal borders are reserved for pressure, movement, confrontation, impact, instability, or a clear directional turn. Quiet intimacy and afterglow do not become “better manga” merely by tilting every border.

Therefore Story Templates are assigned layout families by visual purpose rather than by category alone.

### 4. Panel-area contrast should be deliberate

A “hero” or payoff panel should be meaningfully larger than support panels. Splitting every page into near-equal cells flattens time and emotional hierarchy.

Implementation rule:

- `opposed3`: two compact setup/pressure panels → one large payoff;
- `build4`: one establishment → two focused details/reactions → one dominant payoff;
- `detail5`: four compact observations → one dominant reveal;
- `stair4`: asymmetric left/right widths instead of an equal 2×2 grid.

### 5. Stable layouts remain useful

Not every template is migrated to an irregular frame. `three-vertical`, `action3`, and other stable rectangular patterns remain appropriate for quiet progression, physical closeness, silence, and clear linear timing.

### 6. Composition-safe content zone

A slanted frame may be dynamic while the essential face, hand, object, or text still needs a stable readable region. Story Template camera choices continue to carry subject emphasis; border deformation should not force the key subject into a tiny triangular corner.

## Layout families

| Layout ID | Panels | Geometry | Intended use |
| --- | ---: | --- | --- |
| `duel2` | 2 | one shared diagonal seam | before/after, direct contrast, confrontation |
| `opposed3` | 3 | tight diagonal top pair + large rectangular payoff | anger, strike, realization, resolve |
| `zigzag4` | 4 | two rows with alternating shared seams | rapid exchange, counterattack, high tempo |
| `stair4` | 4 | asymmetric rectangular 2×2 | dialogue, reactions, comedy |
| `build4` | 4 | wide setup + two details + large payoff | confession, awakening, character intro |
| `detail5` | 5 | four compact details + large reveal | suspense, clues, discovery |

Legacy `diagonal3` and `diagonal4` remain load-compatible but resolve to the new shared-seam geometry.

## Template catalog decisions

Dynamic diagonal families:

- `action`, `decisiveBlow`, `aerialAttack`, `throwTechnique`, `rushImpact35`, `angerBurst`, `shockReveal35`, `resolve` → `opposed3`
- `counterattack`, `rapidExchange35` → `zigzag4`

Asymmetric rectangular families:

- dialogue / light-reaction templates such as `classroomTalk`, `teaseBlush`, `smugFail` → `stair4`
- buildup / hero-shot templates such as `confession`, `awakening`, `characterIntro` → `build4`

Intentionally stable patterns:

- quiet/intimate progressions such as `crying`, `kissBefore`, `kissAfter`, `quietAftermath35` remain on stable rectangular layouts unless their authored semantics later justify a stronger cut.

New catalog coverage:

- `beforeAfter37` — `duel2`
- `turningPoint37` — `build4`
- `detailReveal37` — `detail5`

## Automated acceptance criteria

The regression validator checks:

1. every layout returns the intended panel count;
2. all panel points stay inside the canvas and remain usable in area;
3. diagonal families use no more than 5.5% of the inner working area as gutters / inter-panel whitespace;
4. hero-oriented layouts have at least 1.65× area contrast between their largest and smallest panels;
5. legacy `diagonal3` / `diagonal4` resolve to the corrected geometry;
6. representative Story Templates are mapped to the intended families;
7. new diagonal families still participate in the existing `斜めコマ` discovery filter.

These checks prove geometry and catalog contracts, not visual taste. Public page rendering and generated manga still require separate visual/interaction review when available.

## Verification boundary

The deterministic CI evidence for this change covers layout geometry, bounded whitespace, area hierarchy, runtime load order, Story Template application contracts, search/discovery integration, documentation synchronization, and version synchronization. It does **not** by itself prove that every layout is aesthetically optimal after image generation.

A final generated-manga review remains a separate acceptance layer because subject crop, speech-balloon placement, and rendered background density are model-dependent. Browser automation that incurs metered usage is intentionally not part of this verification path; public deployment is verified through build/deploy status and free fetch-only inspection, while visual manga quality should be reviewed from actual generated samples.
