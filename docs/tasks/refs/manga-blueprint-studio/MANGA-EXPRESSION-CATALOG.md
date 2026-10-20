# Manga Expression Catalog — technique + style discovery

This catalog extends the shared knowledge base beyond the initial technique set. It is deliberately broader than the current solver. Humans use it to discover/direct an effect; AI uses the same IDs to reason about candidate techniques and translate intent into Name DSL / generation prompts.

> Model techniques as independent axes. `gekiga` is a visual style; `low-angle` is camera; `aspect-to-aspect` is transition/editing; `scroll-delay` is medium timing. Do not flatten them into one `technique` enum.

## Taxonomy

```text
expression
├─ transition      panel-to-panel temporal/spatial relation
├─ framing         camera distance / angle / lens-like distortion
├─ composition     arrangement, depth, visual weight
├─ panel-grammar   border/page geometry
├─ pacing          perceived time and rhythm
├─ action          motion and impact
├─ attention       eye guidance and reveal
├─ psychological   subjective/emotional abstraction
├─ lettering       balloons, captions, SFX as composition
├─ medium-native   page / spread / vertical-scroll-specific devices
└─ visual-style    line, value, color, texture, deformation, rendering
```

A scene may combine one or more values from every axis.

## 1. Panel-to-panel transitions / editing

The classic six-way vocabulary is useful as a reasoning tool, not a mandatory classification.

| ID | Human term | Effect / use | AI interpretation |
|---|---|---|---|
| `moment-to-moment` | 瞬間→瞬間 | stretches a tiny change; careful observation, suspense, tenderness | small time delta, same subject/space, often higher hold |
| `action-to-action` | 動作→動作 | advances one subject through meaningful stages | omit unneeded in-betweens; preserve causality |
| `subject-to-subject` | 対象→対象 | cuts between participants/details within one scene | preserve scene continuity; shift attention target |
| `scene-to-scene` | 場面→場面 | crosses meaningful time/space | explicit time/location discontinuity |
| `aspect-to-aspect` | 側面→側面 / 情景カット | explores atmosphere or different aspects of one situation | low plot delta; environment/detail attention; useful for mood/hold |
| `non-sequitur` | 非連続 / 異化カット | intentionally breaks obvious continuity | use only with explicit experimental/surreal intent |

Additional useful editing patterns:

- `reaction-cut` — action/information → listener/witness reaction.
- `insert-cut` — temporarily cut to a hand, clue, screen, weapon, eye, object.
- `match-cut` — connect different shots through similar shape/pose/direction.
- `parallel-action` — alternate simultaneous events/locations.
- `montage` — compress repeated actions or a long process into selected moments.
- `ellipsis` — omit intermediate action/time; cause → result.
- `repeat-frame` — repeat nearly identical composition so a small change becomes salient.
- `snap-cut` — abrupt large change in distance/angle/value for shock or comedy.

## 2. Framing and lens-like expression

Beyond close/medium/wide:

- `macro-detail` — extreme detail such as pupil, fingertip, trigger, bead of sweat.
- `over-shoulder` — relationship/dialogue geography with foreground occlusion.
- `two-shot` / `group-shot` — relationship expressed through shared frame.
- `profile-confrontation` — opposing profiles emphasize conflict/distance.
- `foreground-occlusion` — deliberately hide part of subject behind near object; surveillance, tension, depth.
- `frame-within-frame` — door/window/rail/phone screen forms an internal frame.
- `fisheye` — exaggerated radial perspective; speed, comedy, unease, extreme proximity.
- `wide-angle-exaggeration` — near object enlarged, depth stretched.
- `telephoto-compression` — depth visually compressed; crowding, pressure, graphic layering.
- `worm-eye` — extremely low viewpoint.
- `top-shot` — strong overhead composition.
- `canted-horizon` — Dutch angle / instability.
- `subjective-pov` — viewer inherits character viewpoint.

AI rule: lens-like labels describe the desired observable geometry, not a requirement to simulate a real camera model.

## 3. Composition and depth

- `extreme-foreground` — hand/weapon/face dominates near plane.
- `depth-stack` — explicit foreground / midground / background story information.
- `layered-overlap` — overlap establishes depth and priority.
- `negative-space` — empty region used for isolation, anticipation, lettering or gaze destination.
- `symmetry` — order, ritual, confrontation, uncanny stillness.
- `broken-symmetry` — establish order then violate it to make change salient.
- `center-lock` — central subject creates iconic/still impact.
- `edge-pressure` — subject crowds edge; tension or direction out of frame.
- `offscreen-space` — gaze/motion implies important unseen space.
- `scale-contrast` — tiny subject against huge environment or vice versa.
- `silhouette-read` — pose/action readable from outer contour alone.
- `shape-rhyme` — repeated shapes connect beats or subjects.
- `value-mass` — large black/white masses direct attention independent of detail.

## 4. Panel/page grammar

In addition to hero/small/diagonal/bleed/breakout/inset/spread:

- `borderless-panel` — image without explicit frame; memory, atmosphere, openness.
- `floating-panel` — small panel isolated in whitespace.
- `overlap-panel` — one panel overlaps another to imply simultaneity/priority.
- `nested-panel` — inset whose relation to parent is semantically meaningful.
- `fragmented-panel` — one event divided by multiple borders/windows.
- `repeated-grid` — stable repeated geometry; useful before a deliberate break.
- `grid-break` — violate established layout rhythm at a key beat.
- `panoramic-strip` — very wide shallow panel for geography/ensemble.
- `vertical-slit` — narrow tall panel for glance, fall, height or compressed instant.
- `horizontal-slit` — narrow wide panel for eyes, horizon, quick reaction.
- `full-page-splash` — one-page dominant image.
- `double-page-spread` — two-page composition with gutter-aware safe placement.
- `cross-panel-subject` — subject continues across multiple panels; related to but distinct from simple breakout.

## 5. Pacing / time

- `micro-beat` — isolate a tiny reaction or physical change.
- `decompression` — use more panels/aspects for a short story-time interval.
- `compression` — cover long story time with fewer selected images.
- `silent-hold` — no dialogue/action change; reader remains with image.
- `environmental-hold` — aspect shots of room, weather, object, street, sky.
- `anticipation-hold` — pause immediately before action/reveal.
- `aftermath-hold` — remain after impact so consequence registers.
- `accelerando` — progressively shorter/smaller/tighter beats.
- `ritardando` — progressively longer/more spacious beats.
- `rhythmic-repeat` — regular cadence establishes expectation.
- `rhythm-break` — sudden change of panel size/density/spacing produces emphasis.

## 6. Action / impact

- `anticipation-impact-followthrough` — readable physical action chain.
- `contact-focus` — collision/contact point is primary attention target.
- `impact-frame` — isolate exact impact instant.
- `impact-flash` — temporary white/black/value inversion at collision.
- `motion-smear` — stretched/smeared shape implies very fast movement.
- `afterimage` — repeated silhouettes imply trajectory/speed/uncanny movement.
- `multi-pose` — several phases of one body shown in one composition.
- `trajectory-arc` — visible implied/explicit path of weapon/body/object.
- `speed-lines` — directional motion field.
- `focus-lines` — convergent attention field.
- `debris-field` — fragments/dust communicate force and direction.
- `camera-shake` — unstable frame/line treatment around impact.
- `foreshortening` — body/weapon strongly projects toward viewer.
- `counter-motion` — background/lines move against subject vector to increase apparent speed.

## 7. Attention / reveal

- `gaze-chain` — one character's eyeline hands attention to another target.
- `gesture-pointer` — hand/weapon/body acts as leading line.
- `light-focus` — value/lighting contrast isolates target.
- `detail-before-context` — show clue/detail first, reveal whole later.
- `context-before-detail` — establish geography then isolate important detail.
- `occlusion-reveal` — hide target behind object/panel edge then expose it.
- `progressive-reveal` — reveal subject in stages.
- `false-focus` — intentionally draw attention away before reveal; use carefully.
- `visual-echo` — repeated motif primes later recognition.
- `offscreen-gaze` — face looks outside frame to create expectation.

## 8. Psychological / subjective expression

These are especially important for manga because backgrounds and rendering need not remain literal.

- `background-dropout` — remove literal environment to prioritize emotion.
- `solid-black-field` — isolation, dread, gravity, internal state.
- `white-field` — suspension, shock, tenderness, emptiness.
- `abstract-pattern` — flowers, bubbles, screentone patterns, geometric fields represent mood rather than location.
- `symbolic-background` — flames, storm, flowers, cracked field etc. as emotional metaphor.
- `chibi-cutaway` — temporary deformation for comedy/explanation/reaction.
- `face-shadow` — obscure eyes/face region for dread, shame, anger, concealment.
- `eye-highlight-drop` — remove/alter highlights as an emotional convention; style-dependent.
- `expression-overlay` — enlarged face/eye/memory image layered over scene.
- `memory-vignette` — soft/borderless fragment representing recollection.
- `dream-distortion` — warped space/value/line rules indicate subjective state.
- `metaphoric-insert` — nonliteral image communicates an idea/emotion.

AI rule: do not infer a character's actual mental/medical state from a visual convention. Treat these as authored expressive devices.

## 9. Lettering as direction

- `balloon-chain` — balloon placement forms reading path.
- `balloon-spacing` — physical distance controls pause.
- `whisper-balloon` / `shout-balloon` — border/scale communicates delivery.
- `offpanel-balloon` — voice originates outside visible frame.
- `overlap-balloon` — controlled interruption/overlap in dialogue.
- `caption-bridge` — narration bridges time/location transition.
- `sfx-as-object` — SFX occupies depth/space like a graphic object.
- `sfx-crop` — oversized SFX extends beyond frame for force.
- `sfx-vector` — lettering orientation reinforces movement direction.
- `silence-by-absence` — expected text omitted to create a beat.

Visible text remains allowlisted; annotations never become lettering.

## 10. Vertical-scroll native grammar

Do not merely stretch a page layout vertically. In vertical scroll, viewport and physical scroll distance participate in timing.

- `scroll-delay` — blank distance before next visible beat creates delay.
- `viewport-reveal` — payoff enters only after scrolling below current screen.
- `continuous-vertical-pan` — one environment/image extends through multiple screen heights.
- `long-fall` — subject/scene travels through a very tall composition.
- `tight-scroll-burst` — short gaps + compact panels accelerate action/dialogue.
- `screen-hold` — one image approximately owns the viewport for emphasis.
- `gutter-sfx` — SFX spans whitespace and pulls attention downward.
- `color-wash-transition` — continuous background/value/color field marks mood/time/state change.
- `episode-end-stop` — final visual designed as a hard unresolved endpoint.

Do not canonize arbitrary pixel values. Store pacing in semantic units such as `tight`, `normal`, `long`, `screen`, or normalized viewport distance; resolve pixels from the export profile.

## 11. Visual-style axes

A style should be composable rather than a single opaque label.

### Line

`clean-thin`, `clean-bold`, `variable-weight`, `rough`, `scratchy`, `brush-ink`, `dry-brush`, `pencil`, `marker`, `no-outline`

### Value / shading

`flat-white`, `screentone`, `crosshatch`, `heavy-black`, `high-key`, `low-key`, `cel-shading`, `soft-render`, `painterly`

### Color

`monochrome`, `limited-palette`, `spot-color`, `full-color`, `pastel`, `muted`, `high-saturation`, `duotone`, `retro-print`

### Shape / deformation

`realistic-proportion`, `stylized`, `chibi-sd`, `angular`, `rounded`, `graphic-flat`, `caricatured`

### Surface / texture

`clean-digital`, `paper-grain`, `halftone`, `risograph-like`, `watercolor`, `gouache-like`, `ink-wash`, `collage`, `photobash-mixed`

### Background treatment

`detailed-realistic`, `simplified`, `line-background`, `painted-background`, `tone-background`, `abstract-emotion`, `minimal`, `photo-derived`

### Named style families as presets, not authorities

These labels are useful human shorthand but should expand into axes before prompting/solving:

- `gekiga-like` — comparatively realistic proportions, strong blacks, texture/hatching, restrained deformation.
- `shojo-decorative` — expressive close-ups, decorative/abstract emotional fields, light line, symbolic motifs.
- `shonen-action` — readable silhouettes, strong motion/impact grammar, variable line weight, graphic effects.
- `seinen-realistic` — restrained deformation, environmental detail, controlled values, cinematic framing.
- `yonkoma-simple` — stable grid, economical backgrounds, expression/timing priority.
- `webtoon-color` — phone-readable full color, clean silhouettes, vertical-scroll composition.
- `anime-cel` — clean outlines, flat/cel shading, controlled palette.
- `rough-storyboard` — construction line, minimal rendering, composition-first.
- `ink-wash` — brush contour, value wash, negative-space emphasis.
- `retro-print` — limited palette, halftone/misregistration-like texture, graphic shapes.
- `collage-mixed-media` — photographic/paper/paint elements intentionally combined.

Avoid prompts such as “in the style of [living artist]”. Prefer observable axes and techniques.

## 12. Genre × technique candidate expansion

Genre is a weak prior; scene purpose remains stronger.

- **action/battle**: anticipation-impact-followthrough, contact-focus, foreshortening, extreme-foreground, diagonal/grid-break, counter-motion, aftermath-hold.
- **comedy**: stable setup grid, snap-cut, repeat-frame, chibi-cutaway, silent-hold before/after punchline, reaction-cut.
- **romance**: gaze-chain, macro-detail (eyes/hands), aspect-to-aspect, negative-space, environmental-hold, background-dropout, decorative symbolic field.
- **horror**: offscreen-space, foreground-occlusion, progressive-reveal, negative-space, face-shadow, rhythm-break, long aftermath, subjective distortion.
- **mystery**: insert-cut, detail-before-context, visual-echo, controlled occlusion, establishing geography, reaction-cut.
- **slice-of-life**: aspect-to-aspect, environmental-hold, stable rhythm, medium/two-shot, restrained background detail.
- **sports**: wide geography, anticipation-impact-result, trajectory-arc, foreshortening, insert detail, reaction-cut, decompression around decisive play.
- **drama**: reaction-cut, close/macro detail, silence-by-absence, negative-space, value-mass, rhythm-break.
- **experimental/surreal**: non-sequitur, fragmented-panel, dream-distortion, metaphoric-insert, collage, impossible spatial continuity.

## 13. Human → AI examples

Human:

> 告白する直前、時間が止まったみたいにしたい。相手の顔をすぐ見せず、手と夕焼けを挟んで。

AI semantics:

```yaml
pacing: anticipation-hold
transition: aspect-to-aspect
sequence:
  - attention: speaker.hand
    camera: macro-detail
  - attention: environment.sunset
    camera: establishing-detail
  - attention: listener.face
    camera: close
reveal: delayed
```

Human:

> パンチを一発だけ、とんでもなく速く見せたい。

AI semantics:

```yaml
transition: ellipsis
action:
  anticipation: short
  impact: isolated
  followThrough: visible
techniques:
  - foreshortening
  - counter-motion
  - impact-flash
  - debris-field
attention:
  primary: fist.contact
```

Human:

> 縦読み。正体が見えるまでかなり溜めたい。

AI semantics:

```yaml
medium: vertical-scroll
pacing: scroll-delay
reveal: viewport-reveal
attention: hidden-subject
spacing:
  beforeReveal: long
```

## 14. Knowledge-to-prompt contract

When converting a chosen technique/style to an image-generation prompt:

1. Preserve explicit human technique choices.
2. Expand style-family labels into observable line/value/color/shape/texture/background attributes.
3. Translate technique IDs into observable image constraints, not jargon alone.
4. Keep timing/editing semantics in JSON/sequence instructions when a single still cannot depict them directly.
5. Do not duplicate geometry already represented by Clean.
6. Explain AI-proposed techniques to the human before hard-locking them.

Example:

```text
Use a close, strongly foreshortened view: the fist dominates the foreground and projects toward the contact point. Keep the opponent smaller in the midground. Use directional background streaks opposite the punch vector and a brief high-contrast impact flash around contact. Preserve the supplied panel boundary and contact position.
```

This is preferable to merely saying `dynamic shonen action style`.

## 15. Research notes / provenance

This catalog combines established comics vocabulary with implementation-oriented synthesis. Important distinctions:

- Scott McCloud's commonly taught six panel transitions include moment-to-moment, action-to-action, subject-to-subject, scene-to-scene, aspect-to-aspect and non-sequitur.
- Comics-studies terminology also cautions that these categories are not exhaustive for every narrative or non-diegetic comic.
- Vertical-scroll sources consistently treat whitespace/gutter distance as a pacing mechanism and describe vertically continuous imagery/reveals as medium-native devices.
- Numeric webtoon pixel/gutter recommendations vary substantially by platform/source. Therefore this project stores semantic pacing and resolves export dimensions from a current platform profile instead of treating blog pixel numbers as universal grammar.

Research sources should be refreshed when platform-specific export rules are involved; expressive vocabulary itself is kept provider/platform neutral.
