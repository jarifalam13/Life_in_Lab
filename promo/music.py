# Intense 40 s promo track, synthesised: 120 BPM, D minor.
# 0-4 s riser into the drop, 4-32 s full beat with cut impacts every 2 s,
# 32 s final hit, tail to 40 s.
import numpy as np, wave, sys

SR = 44100
DUR = 40.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)

def t_of(n): return np.arange(n) / SR
def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= N: return
    s = sig[: N - i] * gain
    L[i:i + len(s)] += s * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(s)] += s * np.sqrt(0.5 * (1 + pan))
def env(n, a, d):
    t = t_of(n)
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / d)
def note(m): return 440.0 * 2 ** ((m - 69) / 12)
def saw(f, n, detune=0.0):
    t = t_of(n)
    out = np.zeros(n)
    for d in (-detune, 0, detune):
        ph = (t * f * (1 + d)) % 1.0
        out += 2 * ph - 1
    return out / 3
def lowpass(x, fc):
    # one-pole response applied in the frequency domain (fast)
    F = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(F / (1 + 1j * f / fc), len(x))

# ---- drums ----
def kick(gain=1.0, big=False):
    n = int(SR * (0.9 if big else 0.45)); t = t_of(n)
    f = 45 + 140 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t / (0.35 if big else 0.18))
    s += 0.6 * rng.standard_normal(n) * np.exp(-t / 0.004)
    return np.tanh(s * 2.2) * gain
def snare(gain=1.0):
    n = int(SR * 0.3); t = t_of(n)
    noise = rng.standard_normal(n)
    noise = noise - np.concatenate([[0], noise[:-1]]) * 0.6
    s = noise * np.exp(-t / 0.09) * 0.7 + np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)
    return s * gain
def hat(gain=1.0, open_=False):
    n = int(SR * (0.25 if open_ else 0.05)); t = t_of(n)
    noise = rng.standard_normal(n)
    noise = noise - np.concatenate([[0], noise[:-1]])
    return noise * np.exp(-t / (0.08 if open_ else 0.012)) * gain * 0.35
def impact():
    n = int(SR * 2.5); t = t_of(n)
    boom = np.sin(2 * np.pi * (38 + 60 * np.exp(-t / 0.08)) * t) * np.exp(-t / 0.7)
    crash = rng.standard_normal(n) * np.exp(-t / 0.5) * 0.35
    return np.tanh((boom * 1.6 + crash) * 1.5)
def whoosh(length=0.5, rising=True):
    n = int(SR * length); t = t_of(n)
    noise = rng.standard_normal(n)
    shape = (t / length) ** 2 if rising else np.exp(-t / (length * 0.3))
    s = lowpass(noise, 3000) * shape
    return s * 0.5

# ---- intro 0-4: drone, heartbeat, riser ----
n = int(SR * 4.2); t = t_of(n)
drone = (saw(note(38), n, 0.004) + 0.6 * saw(note(45), n, 0.005)) * np.minimum(1, t / 1.5)
drone = lowpass(drone, 400) * 0.35
add(drone, 0.0)
for k in range(4):
    add(kick(0.55), k * 1.0)
riser = rng.standard_normal(n) * (t / 4.2) ** 3
riser = lowpass(riser, 6000) * 0.45
add(riser, 0.0)
tone = np.sin(2 * np.pi * np.cumsum(200 + 900 * (t / 4.2) ** 2) / SR) * (t / 4.2) ** 2 * 0.12
add(tone, 0.0, 0.3)
add(tone, 0.0, -0.3)

# ---- main section 4-32 ----
DROP, END = 4.0, 32.0
bass_prog = [38, 38, 34, 36, 38, 38, 41, 36]  # D D Bb C D D F C (per bar, 2 s)
arp_sets = {38: [62, 65, 69, 74], 34: [58, 62, 65, 70], 36: [60, 64, 67, 72], 41: [65, 69, 72, 77]}
t0 = DROP
bar = 0
while t0 < END - 1e-6:
    root = bass_prog[bar % len(bass_prog)]
    last_bar = t0 + 2 > END - 1e-6
    for b in range(4):  # beats
        tb = t0 + b * BEAT
        add(kick(1.0), tb)
        if b in (1, 3): add(snare(0.8), tb, 0.05)
        for s16 in range(4):
            add(hat(1.0 if s16 % 2 else 0.6, open_=(s16 == 2 and b == 3)), tb + s16 * BEAT / 4, 0.35)
        # offbeat 8th sub bass
        nb = int(SR * BEAT * 0.48)
        bs = saw(note(root - 12), nb, 0.002) * env(nb, 0.005, 0.18)
        add(lowpass(bs, 300) * 0.9, tb + BEAT / 2)
        add(np.sin(2 * np.pi * note(root - 12) * t_of(nb)) * env(nb, 0.005, 0.2) * 0.8, tb)
    # 16th-note arpeggio lead (enters after the first 4 bars)
    if bar >= 2:
        notes = arp_sets[root]
        for s in range(16):
            m = notes[[0, 1, 2, 3, 2, 1, 0, 2][s % 8]]
            nn = int(SR * BEAT / 4 * 0.9)
            a = saw(note(m), nn, 0.006) * env(nn, 0.003, 0.07)
            add(lowpass(a, 2500 + 1500 * (bar % 4) / 3) * 0.22, t0 + s * BEAT / 4, -0.4 if s % 2 else 0.4)
    # big saw stab on the bar
    ns = int(SR * 0.6)
    stab = sum(saw(note(m), ns, 0.008) for m in (root + 12, root + 15, root + 19)) / 3 * env(ns, 0.004, 0.25)
    add(lowpass(stab, 3500) * 0.35, t0)
    # fill on every 4th bar end, riser before 24 s and 32 s
    if bar % 4 == 3 and not last_bar:
        for k in range(4): add(snare(0.5 + 0.12 * k), t0 + 1.5 + k * BEAT / 4)
    t0 += 2.0
    bar += 1
# cut impacts / whooshes every 2 s
for c in np.arange(6.0, 32.0, 2.0):
    add(whoosh(0.35), c - 0.35, 0.0, 0.6)
add(impact(), DROP, 0.0, 0.9)
add(impact(), 18.0, 0.0, 0.5)
add(impact(), 24.0, 0.0, 0.6)
n = int(SR * 4); t = t_of(n)
add(lowpass(rng.standard_normal(n) * (t / 4) ** 3, 7000) * 0.4, 28.0)

# ---- end: final hit + held chord 32-40 ----
add(impact(), END, 0.0, 1.0)
add(kick(1.2, big=True), END)
n = int(SR * 8); t = t_of(n)
chord = sum(saw(note(m), n, 0.006) for m in (50, 57, 62, 65, 69)) / 5
chord = lowpass(chord, 1800) * np.exp(-t / 3.0) * 0.45
add(chord, END)

# ---- reverb (FFT convolution with a decaying noise IR) ----
irn = int(SR * 1.6); ti = t_of(irn)
ir = rng.standard_normal(irn) * np.exp(-ti / 0.45)
ir[: int(SR * 0.01)] = 0
ir /= np.sqrt(np.sum(ir ** 2))
def conv(x):
    m = len(x) + irn
    F = np.fft.rfft(x, m) * np.fft.rfft(ir, m)
    return np.fft.irfft(F, m)[: len(x)]
L = L + 0.18 * conv(L); R = R + 0.18 * conv(R)

# ---- master: fade out tail, soft limit, normalise ----
fade = np.ones(N)
fs = int(SR * 37.0)
fade[fs:] = np.linspace(1, 0, N - fs)
L *= fade; R *= fade
mix = np.stack([L, R], 1)
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.8)
mix = mix / np.max(np.abs(mix)) * 0.93
out = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
print('wrote', DUR, 's')
