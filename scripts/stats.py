#!/usr/bin/env python3
"""Significance tests and confidence intervals for the headline findings.
Usage: python3 scripts/stats.py data/games   (standard library only)."""
import json, glob, random, math, sys
from math import comb
G = sys.argv[1]
S = [json.load(open(f)) for f in glob.glob(G + "/*.summary.json")]
S = [s for s in S if s.get("clean", True) and s["compositionClass"] == "3AI"]
def variant(s): return s.get("variant") or ("v%d" % s.get("rulesVersion", 1))
def fisher(a, n1, b, n2):  # two-sided Fisher exact on 2x2
    K = a + b; N = n1 + n2
    p = lambda x: comb(n1, x) * comb(n2, K - x) / comb(N, K)
    p0 = p(a); lo = max(0, K - n2); hi = min(K, n1)
    return sum(p(x) for x in range(lo, hi + 1) if p(x) <= p0 * (1 + 1e-9))
def wilson(k, n, z=1.96):
    ph = k / n; d = 1 + z * z / n; c = (ph + z * z / (2 * n)) / d; h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d
    return max(0, c - h), min(1, c + h)
def boot(xs, ys, B=20000):
    random.seed(1); ds = []
    for _ in range(B):
        a = [random.choice(xs) for _ in xs]; b = [random.choice(ys) for _ in ys]
        ds.append(sum(b) / len(b) - sum(a) / len(a))
    ds.sort(); return ds[int(.025 * B)], ds[int(.975 * B)]
def perm(xs, ys, B=20000):
    random.seed(2); obs = abs(sum(ys) / len(ys) - sum(xs) / len(xs)); allv = xs + ys; c = 0
    for _ in range(B):
        random.shuffle(allv); a = allv[:len(xs)]; b = allv[len(xs):]
        if abs(sum(b) / len(b) - sum(a) / len(a)) >= obs - 1e-12: c += 1
    return (c + 1) / (B + 1)
tet = [s for s in S if s.get("game","outpost") == "tethered"]
def team(s): return "haiku3" if s["compositionKey"].count("haiku") == 3 else "mixed"
print("== Tethered summits by variant ==")
for v in ["v1", "v2-rules-only", "v2-radio-only", "v2"]:
    for t in ["mixed", "haiku3"]:
        g = [s for s in tet if variant(s) == v and team(s) == t]
        k = sum(1 for s in g if s["won"]); lo, hi = wilson(k, len(g))
        print(f"{v:14} {t:7} {k}/{len(g)}  95% CI {lo:.0%}-{hi:.0%}")
g1m = [s for s in tet if variant(s) == "v1" and team(s) == "mixed"]; g1h = [s for s in tet if variant(s) == "v1" and team(s) == "haiku3"]
print("v1 mixed vs haiku3 Fisher p =", f"{fisher(sum(s['won'] for s in g1m), len(g1m), sum(s['won'] for s in g1h), len(g1h)):.2g}")
seeds_m = {s["seed"]: s["won"] for s in g1m}; seeds_h = {s["seed"]: s["won"] for s in g1h}
common = sorted(set(seeds_m) & set(seeds_h)); disc = [(seeds_m[x], seeds_h[x]) for x in common if seeds_m[x] != seeds_h[x]]
print("paired seeds:", len(common), "discordant:", len(disc), "all favour mixed:", all(a for a, b in disc), "sign-test p =", f"{2 * 0.5 ** len(disc):.2g}" if disc else "-")
for v in ["v2-rules-only", "v2-radio-only", "v2"]:
    gv = [s for s in tet if variant(s) == v and team(s) == "mixed"]
    gb = [s for s in tet if variant(s) == "v1" and team(s) == "mixed" and s["seed"] in {x["seed"] for x in gv}]
    print(f"mixed v1 (same seeds) {sum(s['won'] for s in gb)}/{len(gb)} vs {v} {sum(s['won'] for s in gv)}/{len(gv)}: Fisher p = {fisher(sum(s['won'] for s in gb), len(gb), sum(s['won'] for s in gv), len(gv)):.2g}")
def hshare(s):
    hs = [p for p in s["players"] if "haiku" in p["label"]]
    acts = sum(p["climbs"] + p["anchors"] + p["waits"] for p in hs); return sum(p["climbs"] for p in hs) / acts
print("== Haiku climb share per game, v1 ==")
xa = [hshare(s) for s in g1h]; xm = [hshare(s) for s in g1m]
print(f"all-Haiku {sum(xa)/len(xa):.0%} (n={len(xa)})  Haiku in mixed {sum(xm)/len(xm):.0%} (n={len(xm)})")
lo, hi = boot(xa, xm); print(f"difference {sum(xm)/len(xm)-sum(xa)/len(xa):+.0%}, bootstrap 95% CI {lo:+.0%} to {hi:+.0%}, permutation p = {perm(xa, xm):.2g}")
print("== Warn rate (v1, all AI climbers) ==")
P = [p for s in tet if variant(s) == "v1" for p in s["players"]]
felt = sum(p["holdsFelt"] for p in P); warned = sum(p["holdsWarned"] for p in P)
print("holdsFelt", felt, "holdsWarned", warned)
print("== Outpost hard ==")
op = [s for s in S if s.get("game","outpost") == "outpost" and s.get("difficulty") == "hard"]
for t in ["mixed", "haiku3"]:
    g = [s for s in op if team(s) == t]; k = sum(1 for s in g if s.get("won") or s.get("rescued")); lo, hi = wilson(k, len(g))
    surv = sum(s.get("survivors", 0) for s in g)
    print(f"{t} rescued {k}/{len(g)} CI {lo:.0%}-{hi:.0%}, survivors total {surv}")
gm = [s for s in op if team(s) == "mixed"]; gh = [s for s in op if team(s) == "haiku3"]
km = sum(1 for s in gm if s.get("won") or s.get("rescued")); kh = sum(1 for s in gh if s.get("won") or s.get("rescued"))
print("Fisher p =", f"{fisher(km, len(gm), kh, len(gh)):.2g}")

