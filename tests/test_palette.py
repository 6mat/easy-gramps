"""The colour tokens in tree.css: the dark set is written twice (device in dark mode; ☰ Menu → Dark), so the two copies
must stay the same, and the pairs people read must keep their contrast (WCAG 2: text 4.5:1, lines and rings 3:1)."""
import re
from pathlib import Path

CSS = (Path(__file__).parent.parent / "app/static/tree.css").read_text()


def tokens(block):
    return dict(re.findall(r"(--[\w-]+):\s*([^;]+);", block))


LIGHT = tokens(re.search(r"\n:root \{(.*?)\n\}", CSS, re.S).group(1))
AUTO = tokens(re.search(r":root:not\(\[data-theme=\"light\"\]\) \{(.*?)\n  \}", CSS, re.S).group(1))
DARK = tokens(re.search(r":root\[data-theme=\"dark\"\], \.viewer \{[^\n]*\n(.*?)\n\}", CSS, re.S).group(1))


def test_both_dark_copies_match():
    assert AUTO == DARK


def lum(hex_):
    c = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(t, a, b):
    def val(k):  # a token's hex value, through var(--other)
        k = t[k].strip()
        return val(k[4:-1]) if k.startswith("var(") else k
    x, y = sorted((lum(val(a)), lum(val(b))), reverse=True)
    return (x + 0.05) / (y + 0.05)


TEXT = [("--ink", "--bg"), ("--muted", "--card"), ("--muted", "--canvas"), ("--accent", "--card"), ("--accent-ink", "--accent"),
        ("--ok", "--ok-soft"), ("--bad", "--card"), ("--sel-ink", "--sel-soft"), ("--solid-ink", "--bad"),
        ("--solid-ink", "--sel-ink"), ("--solid-ink", "--ok")]
LINES = [("--ring", "--card"), ("--ring", "--canvas"), ("--sel", "--canvas"), ("--edge", "--card"), ("--edge", "--canvas")] + [
    (f"--f{i}", "--canvas") for i in range(6)]


def test_contrast():
    for name, t in (("light", LIGHT), ("dark", DARK)):
        for need, pairs in ((4.5, TEXT), (3, LINES)):
            for a, b in pairs:
                assert ratio(t, a, b) >= need, f"{name}: {a} on {b} is {ratio(t, a, b):.2f}:1, needs {need}:1"
