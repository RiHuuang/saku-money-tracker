# Saku promo video

`saku-promo.mp4`: a 35-second, 1920×1080, 30 fps motion graphic with a synthesized soundtrack. The copy is in Indonesian and follows the landing page. It uses the landing fonts (Plus Jakarta Sans and Fraunces), the landing palette, and the landing's sample-data app screens, so it shows no real user data.

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

## Re-render

```sh
python3 promo/soundtrack.py   # writes promo/soundtrack.wav (numpy only)
node promo/render.mjs         # writes promo/saku-promo.mp4 (Playwright + ffmpeg)
```

`node promo/render.mjs --stills 4.2,14,23.8` writes single frames to `promo/stills/` for quick checks. `--silent` skips the audio. Open `promo/index.html` in a browser to watch it loop in real time, or add `?t=12` to hold one frame.

Each frame depends only on the timestamp (`seek(t)` in `index.html`). Change scene timing in the `build()` timeline. If you shift a scene, also move the matching sound cues in `soundtrack.py`.
