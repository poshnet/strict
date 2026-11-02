# brand/higgs — photographic assets (Higgsfield, 2026-10-31)

Photographic brand assets for strict.fun, made to look like real product and studio photography. No people, no other
companies' logos, and no claims. Every model was told to render no text. The only text on any asset is either our real
UI or type set by us in HTML (the X header).

## The files

| file | what it is | how it was made |
|---|---|---|
| `mockup-laptop-board.jpg` (2752×1536) | Unbranded laptop on a walnut desk at night, lamp glow, showing the real home board | Nano Banana Pro rendered the scene with a flat chroma-green screen. Our real desktop screenshot (1440×900 @2x, local demo coins) was then composited in Chrome: four screen edges fitted by least squares, homography with bilinear sampling, soft mask, green and cyan spill removed. The UI is pixel-real, not model-drawn. |
| `mockup-phone-board.jpg` (1856×2304) | Unbranded phone lying on a charcoal desk with an amber rim light, showing the real mobile board | Same green-screen route, with the phone screenshot (390×844 @3x). |
| `mockup-phone-coin-stand.jpg` (1856×2304) | Phone on a black stand next to a mechanical keyboard, showing the $POST coin page | Nano Banana Pro with our mobile coin-page screenshot as a reference. The **UI is redrawn by the model**: it matches closely, but tiny text (a shortened address) can differ, and the keyboard legends are model-made. Fine at feed size; for exact UI use the two green-screen mockups. |
| `texture-anodized-edge.jpg` (2752×1536) | Macro of black bead-blasted aluminium with one amber light line on the chamfer | Nano Banana Pro, text-only prompt |
| `texture-steel-line.jpg` (3168×1344) | Dark brushed steel with one long horizontal amber light reflection | Nano Banana Pro, text-only prompt |
| `texture-reeded-glass.jpg` (2752×1536) | Amber light through full-frame vertical reeded glass | Nano Banana Pro, text-only prompt |
| `x-header-steel-plain.jpg` (3000×1000) | The steel line cropped to X's 3:1 header | crop of `texture-steel-line.jpg` |
| `x-header-steel.jpg` (3000×1000) | The same, with "Pick the rules. The code enforces them." top right and `{s} strict.fun · Strict can be fun.` bottom right (clear of the profile picture) | HTML over the photo, rendered with puppeteer at 2x (Sora, Geist Mono mark) |
| `loop-anodized-edge.mp4` (1284×716, 24 fps) | 5 s seamless loop: the amber edge light moves slowly along the chamfer | Kling 3.0 std, silent; start and end frame both `texture-anodized-edge` |

## Prompts (abridged)

- Device scenes: "Real photograph of a thin, completely unbranded dark grey laptop … open on a dark walnut desk in a dim
  room at night. The display shows a perfectly flat, uniform pure chroma green (#00FF00) screen … warm amber light from an
  off-frame desk lamp … 35mm lens, natural depth of field and film grain." The phone version is the same idea: lying flat,
  rotated, amber rim light, 50mm lens.
- Textures: "Macro photograph of a black anodized aluminium surface … a single thin edge catching warm amber light
  (#FF8A1F) along a precise machined chamfer …" / "Wide photograph of dark brushed steel … one long straight horizontal
  line of warm amber light …" / "Close-up photograph filling the entire frame with vertical reeded glass, warm amber light
  glowing from behind …". Every prompt ends with "no text, no logos".

## Dropped (generated, not kept)

- A phone lying on a desk with the board as a model-drawn reference: the UI was warped (rows ran off the screen, text
  garbled).
- A laptop with the board as a model-drawn reference: subtly garbled UI text, and a "MacBook Pro" label on the bezel.
- Reeded glass, first try: came out as a small framed window, not a texture.

## Credits

Nano Banana Pro at 2K costs 2 credits an image: 9 images, 18 credits. The Kling loop cost 7.5 credits. Total: **25.5
credits** (balance 202.39 before).

## Redo the green-screen composites

`brand/higgs/composite.mjs` (puppeteer + canvas, no other dependencies). The green-screen scenes are kept in the
Higgsfield library (jobs `29868920…` laptop, `24451aec…` phone): download them again, take a fresh screenshot, then

    node brand/higgs/composite.mjs <green-scene.png> <screenshot.png> <out.png> landscape|portrait

Do this after the site redesign, so the mockups show the new look.

## Updated 2026-10-31

`mockup-laptop-board.jpg` and `mockup-phone-board.jpg` were recomposited with screenshots of the redesigned site (v2:
bigger type, three-number header, market-cap board) onto the same green-screen scenes (jobs
`29868920-0443-4d11-b7b3-ee604e36d5a7` laptop, `24451aec-ad69-456e-8e97-05d917ecc743` phone), no new credits.
`mockup-phone-coin-stand.jpg` still shows the old coin page (the model redrew it, so it can't be recomposited).

The screens show the local demo stack's test coins ($ROPE, $POST, …) and its numbers (7 coins, 2 buys stopped). They are a
picture of the product, not traction: don't caption them with those numbers as if they were live.

