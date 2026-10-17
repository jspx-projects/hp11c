#!/usr/bin/env python3
"""
compare.py - differential tester: original HP-11C ROM (run on the Nonpareil
Nut core via bin/hp11c-sim) vs the JS reimplementation (hp11c-engine.js).

Each test is a sequence of key tokens.  Tokens:
    f g                  prefix keys
    <KEYNAME>            a key from the shared vocabulary below

The ROM is cold-booted, Pr Error cleared, then the token sequence is typed.
The JS engine is reset to FIX 4 (the ROM power-on default) and the same tokens
are typed.  The resulting LCD "glass" strings are compared.

Usage:
    ./compare.py                run the built-in test battery
    ./compare.py -v             also print every step
"""

import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "bin", "hp11c-sim")
NCD = os.path.join(HERE, "build", "11c.ncd")

# name -> user keycode (== JS POS/LAYOUT position code)
KEYS = {
    "SQRT": 11, "EXP": 12, "TENX": 13, "YX": 14, "INV": 15, "CHS": 16,
    "7": 17, "8": 18, "9": 19, "DIV": 10,
    "SST": 21, "GTO": 22, "SIN": 23, "COS": 24, "TAN": 25, "EEX": 26,
    "4": 27, "5": 28, "6": 29, "MUL": 20,
    "RS": 31, "GSB": 32, "RDN": 33, "SWAP": 34, "BACK": 35, "ENTER": 36,
    "1": 37, "2": 38, "3": 39, "SUB": 30,
    "ON": 41, "F": 42, "G": 43, "STO": 44, "RCL": 45,
    "0": 47, "DOT": 48, "SIGMA": 49, "ADD": 40,
}

GLASS_RE = re.compile(r"glass=\[(.*?)\]")


def run_rom(tokens):
    """Type tokens into the ROM simulator, return the final glass string."""
    lines = ["41", "35"]  # ON, then clear Pr Error
    for t in tokens:
        if t == "f":
            lines.append(str(KEYS["F"]))
        elif t == "g":
            lines.append(str(KEYS["G"]))
        else:
            if t not in KEYS:
                raise SystemExit("unknown token %r" % t)
            lines.append(str(KEYS[t]))
    # let slow operations (y^x, trig, Gamma, ...) finish and stabilise, then sample
    lines += ["wait 2000", "dump", "wait 300", "dump"]
    script = "\n".join(lines) + "\n"
    p = subprocess.run([BIN, "-n", NCD], input=script, text=True,
                       capture_output=True, timeout=60)
    glasses = GLASS_RE.findall(p.stdout)
    if not glasses:
        return None, p.stdout + p.stderr
    return glasses[-1], p.stdout


def run_js(tokens):
    cmd = ["node", os.path.join(HERE, "js_glass.js"), "FIX4"] + tokens
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    m = GLASS_RE.search(p.stdout)
    if not m:
        return None, p.stdout + p.stderr
    return m.group(1), p.stdout


def fmt_got(g):
    return repr(g)


def main():
    verbose = "-v" in sys.argv

    tests = [
        ("heat loss  15*30*.47", "1 5 ENTER 3 0 MUL DOT 4 7 MUL".split()),
        ("2^3", "2 ENTER 3 YX".split()),
        ("2.3+5", "2 DOT 3 ENTER 5 ADD".split()),
        ("98-15", "9 8 ENTER 1 5 SUB".split()),
        ("sqrt(2)", "2 SQRT".split()),
        ("sin(30) deg", "3 0 SIN".split()),
        ("15% of 1000", "1 0 0 0 ENTER 1 5 g YX".split()),
        ("5!", "5 f 0".split()),
        ("sqrt(-4) err", "4 CHS SQRT".split()),
        ("1/0 err", "0 INV".split()),
        ("ln(0) err", "0 g EXP".split()),
        ("abs(-3)", "3 CHS g CHS".split()),
        ("pi", "f CHS".split()),
        ("1e3 eex", "1 EEX 3".split()),
        ("x<>y", "2 ENTER 3 SWAP".split()),
        ("Rv", "1 ENTER 2 ENTER 3 RDN".split()),
        ("FIX 2  1/3", "f 7 2 1 ENTER 3 DIV".split()),
        ("SCI 3 12345", "f 8 3 1 2 3 4 5 g CHS".split()),
        ("ENG 3 12345", "f 9 3 1 2 3 4 5 g CHS".split()),
        ("FIX 4 123.45678", "1 2 3 DOT 4 5 6 7 8".split()),
        ("default mode 1/3", "1 ENTER 3 DIV".split()),
        ("entry 12345", "1 2 3 4 5".split()),
        ("committed 12345", "1 2 3 4 5 ENTER 0 ADD".split()),
        ("1234567 committed", "1 2 3 4 5 6 7 ENTER 0 ADD".split()),
        ("->HMS 17.553", "1 7 DOT 5 5 3 f 2".split()),
        ("->H   17.33108", "1 7 DOT 3 3 1 0 8 g 2".split()),
        ("->P (3,4)", "4 ENTER 3 g EEX".split()),
        ("->R (r=5,th=3.87)", "3 DOT 8 7 ENTER 5 f EEX".split()),
        ("mean 1,2,3", "0 ENTER 1 SIGMA 0 ENTER 2 SIGMA 0 ENTER 3 SIGMA g 0".split()),
        ("stddev 1,2,3", "0 ENTER 1 SIGMA 0 ENTER 2 SIGMA 0 ENTER 3 SIGMA g DOT".split()),
        ("RCL sigma", "0 ENTER 1 SIGMA 0 ENTER 2 SIGMA RCL SIGMA".split()),
        ("1.5!", "1 DOT 5 f 0".split()),
        ("sinh(1)", "1 f GTO SIN".split()),
        ("acosh(1)", "1 g GTO COS".split()),
        ("atanh(1)", "1 g GTO TAN".split()),
        ("2^-3", "2 ENTER 3 CHS YX".split()),
        ("store/recall R5", "7 STO 5 RCL 5".split()),
        ("ISG skip fixture", "1 STO 0 RCL 0".split()),
    ]

    npass = 0
    fails = []
    for name, toks in tests:
        rom, romlog = run_rom(toks)
        js, jslog = run_js(toks)
        ok = (rom is not None and rom == js)
        status = "PASS" if ok else "FAIL"
        print("%s  %-22s rom=%s js=%s" % (status, name, fmt_got(rom), fmt_got(js)))
        if ok:
            npass += 1
        else:
            fails.append((name, toks, rom, js))
        if verbose and not ok:
            print("      rom log:\n" + "\n".join("        " + l for l in romlog.splitlines()))
            print("      js log:\n" + "\n".join("        " + l for l in jslog.splitlines()))

    print("\n%d/%d passed" % (npass, len(tests)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
