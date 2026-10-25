"""Synthesizes promo/soundtrack.wav: a calm, warm bed timed to the promo's scene cuts.

    python3 promo/soundtrack.py

Only needs numpy. Bars are 2.15 s so the journey steps (12.6 s, 16.9 s, 21.2 s)
land on downbeats.
"""
import wave
from pathlib import Path

import numpy as np

SR = 44100
DUR = 35.0
N = int(SR * DUR)
BAR = 2.15
BEAT = BAR / 4
GRID0 = -0.3  # a downbeat falls at 12.6 s
rng = np.random.default_rng(7)
t_all = np.arange(N) / SR


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def place(buf, start, sig):
    i = int(start * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i]


def env_adsr(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] *= np.linspace(1, 0, nr)
    return e


def one_pole(x, cutoff):
    """Simple low-pass; cutoff may be an array (Hz per sample)."""
    c = np.broadcast_to(np.asarray(cutoff, float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for k in range(len(x)):
        acc += a[k] * (x[k] - acc)
        y[k] = acc
    return y


# chord sections: (start, end, midi notes) — D major colours
D, Bm, G, A = [50, 57, 61, 64, 66], [47, 54, 57, 61, 62], [43, 55, 59, 62, 66], [45, 52, 57, 61, 64]
sections = [
    (0.0, 4.0, D), (4.0, 8.3, D), (8.3, 12.6, Bm), (12.6, 16.9, G), (16.9, 21.2, A),
    (21.2, 25.5, D), (25.5, 29.8, Bm), (29.8, 31.95, G), (31.95, 34.1, A), (34.1, DUR, D),
]

pad = np.zeros(N)
bass = np.zeros(N)
for s, e, notes in sections:
    n = int((e - s + 0.8) * SR)
    tt = np.arange(n) / SR
    env = env_adsr(n, 0.5, 0.9)
    sig = np.zeros(n)
    for m in notes[1:]:
        f = hz(m + 12)
        for det in (0.9985, 1.0015):
            sig += np.sin(2 * np.pi * f * det * tt) + 0.18 * np.sin(4 * np.pi * f * det * tt)
    place(pad, s, sig * env / 10)
    fb = hz(notes[0])
    b = (np.sin(2 * np.pi * fb * tt) + 0.25 * np.sin(4 * np.pi * fb * tt)) * env
    place(bass, s, b * 0.5)
# swell the pad in from silence and duck it during the opening
pad *= np.clip(t_all / 2.5, 0, 1)
bass *= np.clip((t_all - 4.8) / 1.0, 0, 1)


def marimba(f, length=1.2):
    tt = np.arange(int(length * SR)) / SR
    body = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 6)
    knock = 0.35 * np.sin(2 * np.pi * f * 4 * tt) * np.exp(-tt * 40)
    att = np.minimum(1, tt / 0.003)
    return (body + knock) * att


plucks = np.zeros(N)
pattern = [0, 2, 1, 3, 2, 4, 3, 1]
for s, e, notes in sections:
    upper = [m + 24 for m in notes[1:]] + [notes[1] + 36]
    k = 0
    beat_t = GRID0 + np.ceil((s - GRID0) / (BEAT / 2)) * (BEAT / 2)
    while beat_t < min(e, 34.1):
        eighth = round((beat_t - GRID0) / (BEAT / 2))
        sparse = beat_t < 5.2  # quarter notes during the opening statement
        if beat_t >= 0.4 and (not sparse or eighth % 2 == 0):
            note = upper[pattern[k % len(pattern)]]
            vel = 0.9 if eighth % 4 == 0 else 0.6
            place(plucks, beat_t, marimba(hz(note)) * vel * 0.16)
            k += 1
        beat_t += BEAT / 2

drums = np.zeros(N)
kt = np.arange(int(0.45 * SR)) / SR
kick = np.sin(2 * np.pi * np.cumsum(48 + 80 * np.exp(-kt * 28)) / SR) * np.exp(-kt * 8)
ht = np.arange(int(0.08 * SR)) / SR
hat_src = np.diff(rng.standard_normal(len(ht) + 1))
hat = hat_src * np.exp(-ht * 70)
b = GRID0
while b < 34.1:
    beat_idx = round((b - GRID0) / BEAT)
    if b >= 8.3 and not (29.3 <= b < 29.8):
        if beat_idx % 2 == 0:
            place(drums, b, kick * 0.55)
        place(drums, b + BEAT / 2, hat * 0.045)
    b += BEAT


def whoosh(length, peak_at):
    n = int(length * SR)
    tt = np.arange(n) / SR
    env = np.where(tt < peak_at, (tt / peak_at) ** 2, np.exp(-(tt - peak_at) * 9))
    cutoff = 300 + 5000 * env
    return one_pole(rng.standard_normal(n), cutoff) * env


def chime(f, length=3.0):
    tt = np.arange(int(length * SR)) / SR
    partials = [(1, 1), (2.76, .35), (5.4, .15), (2, .25)]
    return sum(a * np.sin(2 * np.pi * f * r * tt) * np.exp(-tt * (1.4 + r)) for r, a in partials) * np.minimum(1, tt / .004)


fx = np.zeros(N)
place(fx, 3.9, whoosh(1.5, 1.3) * 0.22)       # tickets fold into the dot
place(fx, 5.45, chime(hz(86)) * 0.13)          # wordmark dot lands
place(fx, 5.45, chime(hz(81)) * 0.09)
bt = np.arange(int(1.6 * SR)) / SR
place(fx, 5.25, np.sin(2 * np.pi * np.cumsum(70 * np.exp(-bt * 1.5) + 36) / SR) * np.exp(-bt * 2.4) * 0.45)
for cut in (7.6, 12.45, 16.75, 21.05, 25.0):
    place(fx, cut, whoosh(0.9, 0.45) * 0.12)
place(fx, 15.0, marimba(hz(93), 0.6) * 0.12)   # Simpan tap
place(fx, 15.95, chime(hz(88), 1.6) * 0.08)    # saved toast
place(fx, 28.6, whoosh(1.4, 1.0) * 0.2)        # into the closing panel
place(fx, 31.3, chime(hz(86)) * 0.13)
place(fx, 31.3, chime(hz(78)) * 0.08)

dry = pad * 0.9 + bass * 0.22 + plucks + drums * 0.8 + fx

# small room: FFT convolution with a decaying-noise impulse response, decorrelated per channel
def reverb(x, seed):
    r = np.random.default_rng(seed)
    n = int(2.2 * SR)
    tt = np.arange(n) / SR
    ir = r.standard_normal(n) * np.exp(-tt * 3.2)
    ir = one_pole(ir, 4500)
    ir /= np.sqrt(np.sum(ir ** 2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return y


wet_src = pad * 0.6 + plucks + fx * 0.8
left = dry + 0.32 * reverb(wet_src, 1)
right = dry + 0.32 * reverb(wet_src, 2)
# gentle stereo spread on the plucks
left += plucks * 0.15
right -= plucks * 0.05

st = np.stack([left, right], axis=1)
fade = np.ones(N)
fade[: int(0.05 * SR)] = np.linspace(0, 1, int(0.05 * SR))
fade[-int(1.4 * SR):] *= np.linspace(1, 0, int(1.4 * SR)) ** 1.5
st *= fade[:, None]
st /= np.max(np.abs(st)) / 0.89
st = np.tanh(st * 1.1) / np.tanh(1.1)

out = Path(__file__).with_name('soundtrack.wav')
with wave.open(str(out), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32000).astype('<i2').tobytes())
print(f'wrote {out}')
