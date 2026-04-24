# AI Remover

Strip the Gemini watermark (or any small logo) from AI-generated images — entirely in your browser. No API, no key, no upload.

## How it works

1. Drop in an image.
2. Drag a box over the watermark (a default box is pre-placed in the bottom-right corner).
3. Click **Remove** — a diffusion-based inpainting fills the selection from surrounding pixels.
4. Draw more boxes to clean additional spots, then **Download**.

Best on small logos over reasonably uniform backgrounds. Busy textures inside a large box will look smeared — use a tight box.

## Stack

- Next.js 13 (App Router) + TypeScript
- Tailwind + shadcn/ui
- Canvas 2D + a simple diffusion inpainter (no ML dependency)

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Notes

- Gemini also embeds an invisible [SynthID](https://deepmind.google/technologies/synthid/) watermark that this tool does not (and cannot) touch.
- Only remove watermarks from images you own or have rights to.
