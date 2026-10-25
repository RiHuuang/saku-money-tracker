# Saku promo video

Two cuts of the same 35-second, 30 fps motion graphic with a synthesized soundtrack:

- `saku-promo.mp4`: 16:9, 1920×1080, for YouTube, the web and presentations.
- `saku-promo-vertical.mp4`: 9:16, 1080×1920, for Instagram Reels and TikTok (also works for Shorts and Stories).

Both cuts use the same timeline, so scene timing and the soundtrack match. The copy is in Indonesian and follows the landing page. It uses the landing fonts (Plus Jakarta Sans and Fraunces), the landing palette, and the landing's sample-data app screens, so it shows no real user data.

| Time | Scene |
| --- | --- |
| 0–5s | "Uangmu bergerak setiap hari. Sekarang ceritanya bisa kamu lihat." Transaction tickets drift in, then fold into the logo dot. |
| 5–8s | The `saku.` wordmark appears and moves to the header. |
| 8–12.5s | Hero "Tahu ke mana uangmu pergi." The Home screen appears and recorded cash counts up. |
| 12.5–17s | 01 / CATAT: an entry is typed and saved into Activity. |
| 17–21s | 02 / ATUR: pocket budgets fill on the Pockets screen. |
| 21–25.5s | 03 / PAHAMI: the cash-flow chart and the largest-category donut on Insights. |
| 25.5–29.5s | Catch up, Plans, Widget, Kendali. |
| 29.5–35s | Closing on Saku green with the Android download prompt and sakumoney.my.id. |

## Vertical safe zone

The vertical cut keeps every headline, the logo, prices, the CTA and the "data contoh" label inside the area that neither Instagram Reels nor TikTok covers with its interface. It uses the strictest published numbers from the two platforms, Meta's Reels ad guidance (14% top, 35% bottom) and TikTok's in-feed ad template (120 px sides plus the right-hand action rail):

| Keep clear | Pixels (1080×1920) |
| --- | --- |
| Top | 0–270 |
| Bottom | 1248–1920 |
| Left and right | 120 on each side |
| Right action rail | x 780–960, from y 840 down to 1248 |

Backgrounds, the green art panel and the lower half of the phone screenshot run under the interface on purpose. They're decoration, and nothing important sits there. Text that differs between the two layouts is hidden in the vertical cut: the hero lead, step paragraphs, feature descriptions and figure caption. Run `node promo/render.mjs --format vertical --guides --stills 11,19.5` to shade the unsafe area on stills, or open `index.html?format=vertical&guides=1`.

## Re-render

```sh
python3 promo/soundtrack.py   # writes promo/soundtrack.wav (numpy only)
node promo/render.mjs         # writes promo/saku-promo.mp4 (Playwright + ffmpeg)
node promo/render.mjs --format vertical   # writes promo/saku-promo-vertical.mp4
```

`node promo/render.mjs --stills 4.2,14,23.8` writes single frames to `promo/stills/` for quick checks. `--silent` skips the audio. Open `promo/index.html` in a browser to watch it loop in real time, or add `?t=12` to hold one frame. Add `?format=vertical` to preview the 9:16 cut.

Each frame depends only on the timestamp (`seek(t)` in `index.html`). Change scene timing in the `build()` timeline. The vertical cut changes only the layout, through the `.v` CSS rules and the `L` constants. Headlines that need different line breaks in 9:16 set them in `data-v`. If you shift a scene, also move the matching sound cues in `soundtrack.py`.
