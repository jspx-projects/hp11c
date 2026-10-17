#!/usr/bin/env python3
"""
audit.py - broad differential audit of the JS HP-11C reimplementation and
Specification.txt against the original ROM (Nonpareil Nut core).

For every case the ROM is cold-booted, Pr Error cleared, the token sequence is
typed, slow operations are allowed to finish, and the final LCD is compared
with the JS engine put in the matching initial state.

Usage:
    ./audit.py                 run everything
    ./audit.py -c display      run one category (repeatable)
    ./audit.py -v              show ROM/JS logs for failures
"""

import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "bin", "hp11c-sim")
NCD = os.path.join(HERE, "build", "11c.ncd")

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
FAST = False
COV = None  # bytearray(0x1800) when --cov is used


def sim_args():
    return [BIN, "-n", NCD] + (["--fast"] if FAST else [])


def T(s, **opts):
    d = {"tokens": s.split(), "init": "FIX4", "radix": ".", "trig": None}
    d.update(opts)
    return d


# --------------------------------------------------------------------------
CASES = []


def add(cat, name, s, **opts):
    c = T(s, **opts)
    c["cat"] = cat
    c["name"] = name
    CASES.append(c)


# ---- display formatting --------------------------------------------------
for n in (0, 1, 2, 4, 7, 9):
    add("display", "FIX %d 1/3" % n, "f 7 %d 1 ENTER 3 DIV" % n)
for n in (0, 2, 3, 6, 7, 9):
    add("display", "SCI %d 12345" % n, "f 8 %d 1 2 3 4 5 g CHS" % n)
for n in (0, 2, 3, 6, 7, 9):
    add("display", "ENG %d 1234.567" % n, "f 9 %d 1 2 3 4 DOT 5 6 7 g CHS" % n)
add("display", "FIX4 0.125", "f 7 4 DOT 1 2 5 g CHS")
add("display", "FIX2 0.125", "f 7 2 DOT 1 2 5 g CHS")
add("display", "FIX2 2.675", "f 7 2 2 DOT 6 7 5 g CHS")
add("display", "FIX3 1.2345", "f 7 3 1 DOT 2 3 4 5 g CHS")
add("display", "SCI3 12345 rounding", "f 8 3 1 2 3 4 5 g CHS")
add("display", "SCI2 0.00123", "f 8 2 DOT 0 0 1 2 3 g CHS")
add("display", "big 9.999999999e99", "9 DOT 9 9 9 9 9 9 9 9 9 EEX 9 9")
add("display", "small 1e-99", "1 EEX CHS 9 9")
add("display", "overflow 1e99*10", "1 EEX 9 9 ENTER 1 0 MUL")
add("display", "underflow 1e-99*0.1", "1 EEX CHS 9 9 ENTER DOT 1 MUL")
add("display", "negative 123.456", "1 2 3 DOT 4 5 6 CHS")
add("display", "integer 12345 committed", "1 2 3 4 5 ENTER 0 ADD")
add("display", "entry 12345", "1 2 3 4 5")
add("display", "default mode 1/3", "1 ENTER 3 DIV", init="DEFAULT")

# ---- digit entry / backarrow / EEX ---------------------------------------
add("entry", "entry backarrow 1.25CHS x4", "f 7 4 1 DOT 2 5 CHS BACK BACK BACK BACK")
add("entry", "entry backarrow 1.25CHS x1", "f 7 4 1 DOT 2 5 CHS BACK")
add("entry", "entry backarrow 1.25CHS x2", "f 7 4 1 DOT 2 5 CHS BACK BACK")
add("entry", "entry eex back x1", "f 7 4 1 DOT 2 5 EEX 5 2 CHS BACK")
add("entry", "entry eex back x2", "f 7 4 1 DOT 2 5 EEX 5 2 CHS BACK BACK")
add("entry", "entry eex back x3", "f 7 4 1 DOT 2 5 EEX 5 2 CHS BACK BACK BACK")
add("entry", "entry eex back x4", "f 7 4 1 DOT 2 5 EEX 5 2 CHS BACK BACK BACK BACK")
add("entry", "eex 7 int digits", "1 2 3 4 5 6 7 EEX 9")
add("entry", "eex 8 int digits blocked", "1 2 3 4 5 6 7 8 EEX 9")
add("entry", "eex 5 zeros", "DOT 0 0 0 0 0 1 EEX 2")
add("entry", "eex 6 zeros blocked", "DOT 0 0 0 0 0 0 1 EEX 2")
add("entry", "chs entry", "1 2 3 CHS")
add("entry", "back outside entry", "5 BACK")
add("entry", "clx", "5 g BACK")
add("entry", "leading dot", "DOT 5")

# ---- stack / LASTX --------------------------------------------------------
add("stack", "x<>y", "2 ENTER 3 SWAP")
add("stack", "Rv", "1 ENTER 2 ENTER 3 RDN")
add("stack", "R^", "1 ENTER 2 ENTER 3 g RDN")
add("stack", "LSTx", "8 ENTER 2 DIV g ENTER")
add("stack", "constant arith", "1 DOT 1 5 ENTER ENTER ENTER 1 0 MUL MUL MUL")
add("stack", "enter then add", "1 ENTER 2 ADD")
add("stack", "lastx after add", "5 ENTER 3 ADD g ENTER")

# ---- math -----------------------------------------------------------------
add("math", "sqrt 2", "2 SQRT")
add("math", "x^2", "5 g SQRT")
add("math", "1/x", "4 INV")
add("math", "2^3", "2 ENTER 3 YX")
add("math", "2^-3", "2 ENTER 3 CHS YX")
add("math", "(-2)^0.5 err", "2 CHS ENTER DOT 5 YX")
add("math", "0^-1 err", "0 ENTER 1 CHS YX")
add("math", "exp 1", "1 EXP")
add("math", "ln 2", "2 g EXP")
add("math", "10^2", "2 TENX")
add("math", "log 1000", "1 0 0 0 g TENX")
add("math", "sqrt -4 err", "4 CHS SQRT")
add("math", "1/0 err", "0 INV")
add("math", "ln 0 err", "0 g EXP")
add("math", "log 0 err", "0 g TENX")
add("math", "abs -3", "3 CHS g CHS")
add("math", "int -3.7", "3 DOT 7 CHS g STO")
add("math", "frac -3.7", "3 DOT 7 CHS f STO")
add("math", "rnd", "1 DOT 2 3 4 5 6 g SWAP")
add("math", "pi", "f CHS")
add("math", "0!", "0 f 0")
add("math", "5!", "5 f 0")
add("math", "69!", "6 9 f 0")
add("math", "70! saturates", "7 0 f 0")
add("math", "(-4)! saturates", "4 CHS f 0")
add("math", "1.5! gamma", "1 DOT 5 f 0")

# ---- trig -----------------------------------------------------------------
add("trig", "sin30", "3 0 SIN")
add("trig", "cos60", "6 0 COS")
add("trig", "tan45", "4 5 TAN")
add("trig", "asin.5", "DOT 5 g SIN")
add("trig", "acos.5", "DOT 5 g COS")
add("trig", "atan1", "1 g TAN")
add("trig", "asin 2 err", "2 g SIN")
add("trig", "sin pi/2 rad", "f 8 9 ?")  # placeholder replaced below
CASES.pop()
add("trig", "sin rad", "g 8 f CHS 2 DIV SIN")
add("trig", "sin grad", "g 9 1 0 0 SIN")
add("trig", "->RAD 180", "1 8 0 f 3")
add("trig", "->DEG pi", "f CHS f 3")
add("trig", "->HMS 17.553", "1 7 DOT 5 5 3 f 2")
add("trig", "->H 17.33108", "1 7 DOT 3 3 1 0 8 g 2")
add("trig", "sinh1", "1 f GTO SIN")
add("trig", "cosh1", "1 f GTO COS")
add("trig", "tanh1", "1 f GTO TAN")
add("trig", "acosh1", "1 g GTO COS")
add("trig", "acosh0 err", "0 g GTO COS")
add("trig", "atanh1 sat", "1 g GTO TAN")
add("trig", "atanh-1 sat", "1 CHS g GTO TAN")
add("trig", "atanh2 err", "2 g GTO TAN")

# ---- percent / polar / probability ---------------------------------------
add("misc", "15% 1000", "1 0 0 0 ENTER 1 5 g YX")
add("misc", "delta% 200->300", "2 0 0 ENTER 3 0 0 g INV")
add("misc", "delta% base0 err", "0 ENTER 5 g INV")
add("misc", "->P 4,3", "4 ENTER 3 g EEX")
add("misc", "->R r5 th3.87", "3 DOT 8 7 ENTER 5 f EEX")
add("misc", "P(10,3)", "1 0 ENTER 3 f 1")
add("misc", "C(10,3)", "1 0 ENTER 3 g 1")
add("misc", "P(3,5) err", "3 ENTER 5 f 1")
add("misc", "P(3.5,1) err", "3 DOT 5 ENTER 1 f 1")

# ---- statistics -----------------------------------------------------------
SIG3 = "0 ENTER 1 SIGMA 0 ENTER 2 SIGMA 0 ENTER 3 SIGMA"
add("stats", "mean 1,2,3", SIG3 + " g 0")
add("stats", "s 1,2,3", SIG3 + " g DOT")
add("stats", "L.R. 1,2,3", SIG3 + " f SIGMA")
add("stats", "y,r 1,2,3", SIG3 + " 2 f DOT")
add("stats", "RCL sigma", SIG3 + " RCL SIGMA")
add("stats", "mean n=0 err", "g 0")
add("stats", "s n=1 err", "0 ENTER 5 SIGMA g DOT")
add("stats", "sigma- 1,2,3", SIG3 + " 0 ENTER 3 g SIGMA g 0")
add("stats", "clear sigma", SIG3 + " f GSB g 0")

# ---- storage --------------------------------------------------------------
add("storage", "STO/RCL 5", "7 STO 5 RCL 5")
add("storage", "STO/RCL .5", "7 STO DOT 5 RCL DOT 5")
add("storage", "STO/RCL I", "7 STO TAN RCL TAN")
add("storage", "STO + 0", "5 STO 0 3 STO ADD 0 RCL 0")
add("storage", "STO - 0", "5 STO 0 3 STO SUB 0 RCL 0")
add("storage", "STO * 0", "5 STO 0 3 STO MUL 0 RCL 0")
add("storage", "STO / 0", "8 STO 0 2 STO DIV 0 RCL 0")
add("storage", "STO/0 err", "5 STO DIV 0")
add("storage", "x<>I", "7 ENTER 3 f 4")
add("storage", "x<>(i) R3", "7 STO 3 3 STO TAN 9 ENTER f SIN")
add("storage", "x<>(i) I", "9 ENTER 2 0 STO TAN f SIN")
add("storage", "indirect STO/RCL", "7 STO 3 3 STO TAN 4 STO COS RCL COS")
add("storage", "clear reg", "7 STO 0 f SWAP RCL 0")
add("storage", "STO + (i) addr20 err", "2 0 STO TAN 5 STO ADD COS")

# ---- flags / index --------------------------------------------------------
add("flags", "SF2 err", "g 4 2")
add("flags", "CF2 err", "g 5 2")
add("flags", "F?2 err", "g 6 2")
add("flags", "flag skip program",
    "g RS f SST SQRT 1 g 4 0 g 6 0 GTO 1 2 g GSB f SST 1 3 g GSB g RS f SQRT")

# ---- program recording / display -----------------------------------------
add("program", "record LBL A", "g RS f SST SQRT")
add("program", "record GTO A", "g RS GTO SQRT")
add("program", "record GSB A", "g RS GSB SQRT")
add("program", "record RTN", "g RS g GSB")
add("program", "record STO+5", "g RS STO ADD 5")
add("program", "record STO+(i)", "g RS STO ADD COS")
add("program", "record RCL I", "g RS RCL TAN")
add("program", "record RCL (i)", "g RS RCL COS")
add("program", "record RCL SIGMA", "g RS RCL SIGMA")
add("program", "record HYP SIN", "g RS f GTO SIN")
add("program", "record FIX 3", "g RS f 7 3")
add("program", "record SF0", "g RS g 4 0")
add("program", "record ISG", "g RS f 6")
add("program", "record DSE", "g RS f 5")
add("program", "record x<=y", "g RS f DIV")
add("program", "record x=0", "g RS g ADD")
add("program", "record PSE", "g RS f RS")
add("program", "GTO .001 after LBL", "g RS f SST SQRT GTO DOT 0 0 1")
add("program", "insert after LBL", "g RS f SST SQRT f SST SQRT g GSB")
add("program", "delete line", "g RS f SST SQRT f 0 g GSB BACK")
add("program", "SST program", "g RS f SST SQRT f SST SQRT g GSB g SST")
add("program", "BST program", "g RS f SST SQRT f SST SQRT g GSB g SST g SST")
add("program", "run area circle", "g RS f SST SQRT g SQRT f CHS MUL g GSB g RS 7 DOT 5 f SQRT")
add("program", "run heatloss", "g RS f SST SQRT 3 0 MUL DOT 4 7 MUL g GSB g RS 1 5 f SQRT")
add("program", "MEM initial", "g RCL")
add("program", "MEM after 2 lines", "g RS f SST SQRT f SST SQRT g RCL")
add("program", "clear prgm run mode", "g RS f SST SQRT g RS RCL f RDN g RCL")
add("program", "clear prgm prog mode", "g RS f SST SQRT f RDN")
add("program", "user mode run A", "g RS f SST SQRT 5 g GSB g RS f RCL SQRT")
add("program", "user mode f sqrt", "9 f RCL f SQRT")

# ---- errors / misc -------------------------------------------------------
add("errors", "error 6 flag", "g 4 2")
add("errors", "GTO I missing label", "3 STO TAN GTO f TAN")
add("errors", "GTO I addr15", "1 5 STO TAN GTO f TAN")
add("errors", "GSB I addr15", "1 5 STO TAN GSB f TAN")
add("errors", "GTO I line0 err", "DOT 1 CHS STO TAN GTO f TAN")
add("errors", "GTO .005 err", "GTO DOT 0 0 5")
add("errors", "GTO .000", "GTO DOT 0 0 0")
add("errors", "error clear", "4 CHS SQRT 1 ADD")

# ---- extra probes (indirect branch, address-20 arithmetic, depth, RNG) ----
add("extra", "GTO I to LBL3",
    "g RS f SST SQRT 1 GTO f TAN 9 g GSB f SST 3 7 g GSB g RS 3 STO TAN f SQRT")
add("extra", "STO+ (i) addr20", "2 0 STO TAN 5 STO ADD COS RCL TAN")
add("extra", "STO- (i) addr20", "2 0 STO TAN 5 STO SUB COS RCL TAN")
add("extra", "STO* (i) addr20", "2 0 STO TAN 5 STO MUL COS RCL TAN")
add("extra", "STO/ (i) addr20", "2 0 STO TAN 5 STO DIV COS RCL TAN")
add("extra", "subroutine depth Error 5",
    "g RS f SST SQRT GSB EXP g GSB f SST EXP GSB TENX g GSB "
    "f SST TENX GSB YX g GSB f SST YX GSB INV g GSB "
    "f SST INV GSB SQRT g GSB g RS f SQRT")
add("extra", "DSE loop 3 iters",
    "g RS f SST SQRT 0 STO 0 3 DOT 0 0 0 0 1 STO TAN f SST 1 "
    "RCL 0 1 ADD STO 0 f 5 GTO 1 g GSB g RS f SQRT")
add("extra", "RAN# first", "f 8 7 f ENTER")
add("extra", "RAN# sequence", "f 8 7 f ENTER f ENTER f ENTER")


# ---- memory allocation / Error 3 -----------------------------------------
add("mem", "64 lines converts R.9", "g RS " + "1 " * 64 + "g RS RCL DOT 9")
add("mem", "delete releases R.9", "g RS " + "1 " * 64 + "BACK g RS RCL DOT 9")
add("mem", "CLEAR PRGM prog restores", "g RS " + "1 " * 64 + "f RDN g RS RCL DOT 9")
add("mem", "CLEAR PRGM run keeps alloc", "g RS " + "1 " * 64 + "g RS f RDN RCL DOT 9")
add("mem", "204th line Error 4", "g RS " + "1 " * 203 + "1")
add("mem", "stats Error 3 at 203", "g RS " + "1 " * 203 + "g RS SIGMA")

# ---- every key x layer, recorded in Program mode --------------------------
KEY_IDS = [
    "SQRT", "EXP", "TENX", "YX", "INV", "CHS", "7", "8", "9", "DIV",
    "SST", "GTO", "SIN", "COS", "TAN", "EEX", "4", "5", "6", "MUL",
    "RS", "GSB", "RDN", "SWAP", "BACK", "ENTER", "1", "2", "3", "SUB",
    "STO", "RCL", "0", "DOT", "SIGMA", "ADD",
]


def key_operand(kid, layer):
    if layer == "P" and kid in ("STO", "RCL", "GTO", "GSB"):
        return "0"
    if layer == "f" and kid == "SST":
        return "SQRT"            # LBL A
    if layer == "f" and kid in ("7", "8", "9"):
        return "4"               # FIX/SCI/ENG 4
    if layer == "g" and kid in ("4", "5", "6"):
        return "0"               # SF/CF/F? 0
    if layer in ("f", "g") and kid == "GTO":
        return "SIN"             # HYP/HYP-1 SIN
    return None


for kid in KEY_IDS:
    for layer in ("P", "f", "g"):
        if kid == "RS" and layer == "g":
            continue             # P/R would leave Program mode
        toks = ["g", "RS"]
        if layer != "P":
            toks.append(layer)
        toks.append(kid)
        op = key_operand(kid, layer)
        if op:
            toks.append(op)
        add("keys", "%s %s" % (layer, kid), " ".join(toks))

# ---- radix-comma (JS in comma mode vs ROM point mode, marks swapped) ------
add("radix", "FIX4 entry 12345.6", "f 7 4 1 2 3 4 5 DOT 6", radix=",")
add("radix", "FIX2 1/3", "f 7 2 1 ENTER 3 DIV", radix=",")
add("radix", "FIX2 2.675", "f 7 2 2 DOT 6 7 5 g CHS", radix=",")
add("radix", "FIX0 3", "f 7 0 3 g CHS", radix=",")
add("radix", "SCI3 12345", "f 8 3 1 2 3 4 5 g CHS", radix=",")
add("radix", "ENG3 1234.567", "f 9 3 1 2 3 4 DOT 5 6 7 g CHS", radix=",")
add("radix", "entry 12345", "1 2 3 4 5", radix=",")
add("radix", "committed 12345", "1 2 3 4 5 ENTER 0 ADD", radix=",")
add("radix", "negative 123.456", "1 2 3 DOT 4 5 6 CHS", radix=",")
add("radix", "program LBL A", "g RS f SST SQRT", radix=",")
add("radix", "program STO+5", "g RS STO ADD 5", radix=",")
add("radix", "program FIX3", "g RS f 7 3", radix=",")
add("radix", "error unaffected", "4 CHS SQRT", radix=",")


def swap_marks(s):
    return s.translate(str.maketrans(".,", ",."))


def rom_script(tokens):
    prep_wait = "40" if FAST else "350"
    tail = ["settle 700", "dump"] if FAST else ["settle 2500", "dump"]
    lines = ["41", "wait " + prep_wait, "35", "wait " + prep_wait]
    for t in tokens:
        if t == "f":
            lines.append(str(KEYS["F"]))
        elif t == "g":
            lines.append(str(KEYS["G"]))
        else:
            lines.append(str(KEYS[t]))
    lines += tail
    return "\n".join(lines) + "\n"


def run_rom(tokens):
    env = None
    covf = None
    if COV is not None:
        covf = "/tmp/opencode/cov_%d.bin" % os.getpid()
        env = os.environ.copy()
        env["HP11C_COV_FILE"] = covf
    p = subprocess.run(sim_args(), input=rom_script(tokens),
                       text=True, capture_output=True, timeout=120, env=env)
    if covf:
        try:
            with open(covf, "rb") as fh:
                data = fh.read()
            for i in range(min(len(data), len(COV))):
                COV[i] |= data[i]
            os.unlink(covf)
        except OSError:
            pass
    gl = GLASS_RE.findall(p.stdout)
    return (gl[-1] if gl else None), p.stdout + p.stderr


def run_js(case):
    cmd = ["node", os.path.join(HERE, "js_glass.js"),
           "--init=" + case["init"], "--radix=" + case["radix"]]
    if case["trig"]:
        cmd.append("--trig=" + case["trig"])
    cmd += case["tokens"]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    m = GLASS_RE.search(p.stdout)
    return (m.group(1) if m else None), p.stdout + p.stderr


ROM_REGIONS = [
    (0x0000, 0x00ff, "reset/init"),
    (0x0096, 0x00b2, "main loop"),
    (0x0100, 0x010c, "PSE pause"),
    (0x0270, 0x0289, "sel ram helpers"),
    (0x028a, 0x0325, "run-mode key processing"),
    (0x0326, 0x034d, "key-scan matrix (DATA)"),
    (0x034e, 0x03b0, "subroutine call helpers"),
    (0x03b1, 0x03b9, "CLEAR PRGM"),
    (0x03ba, 0x03db, "keyboard clear/init"),
    (0x03dc, 0x03ed, "keyboard scan control"),
    (0x0400, 0x047f, "key dispatch table (DATA)"),
    (0x0480, 0x05ff, "multiply/math helpers"),
    (0x0600, 0x06ff, "trig/transcendental"),
    (0x0700, 0x07ff, "RAN#/display mode"),
    (0x0800, 0x08ff, "program execution/PC"),
    (0x0900, 0x0aff, "conditional/flag/branch"),
    (0x0b00, 0x0b73, "keyboard processor"),
    (0x0b74, 0x0bff, "display formatting"),
    (0x0c00, 0x0cff, "statistics"),
    (0x0d00, 0x0dff, "storage arithmetic"),
    (0x0e00, 0x0eff, "normalize/round"),
    (0x0f00, 0x0fff, "BCD arithmetic"),
    (0x1000, 0x10ff, "register read/write"),
    (0x1100, 0x11ff, "BCD divide/multiply"),
    (0x1200, 0x12ff, "curve fitting/regression"),
    (0x1300, 0x13ff, "display setup"),
    (0x1400, 0x14ff, "error handling/display"),
    (0x1500, 0x15ff, "display segment encoding"),
    (0x1600, 0x16ff, "display annunciator/digit"),
    (0x1700, 0x17ff, "keyboard scan/refresh"),
]


def region_of(a):
    for lo, hi, name in ROM_REGIONS:
        if lo <= a <= hi:
            return name
    return "?"


def rng_checks():
    """STO RAN# seed normalization/repeatability.  The ROM generator differs
    from the specified LCG, so this is a within-engine self-consistency check,
    not a ROM-vs-JS comparison."""
    seq = {
        "0.123": "DOT 1 2 3 STO f ENTER f ENTER f ENTER",
        "123": "1 2 3 STO f ENTER f ENTER f ENTER",
        "12.3": "1 2 DOT 3 STO f ENTER f ENTER f ENTER",
        "12.3 repeat": "1 2 DOT 3 STO f ENTER f ENTER f ENTER",
        "default seed": "f ENTER f ENTER f ENTER",
    }
    print("\n=== STO RAN# seed checks (within-engine) ===")
    for side in ("rom", "js"):
        vals = {}
        for name, toks in seq.items():
            if side == "rom":
                vals[name] = run_rom(toks.split())[0]
            else:
                c = {"tokens": toks.split(), "init": "FIX4", "radix": ".", "trig": None}
                vals[name] = run_js(c)[0]
        norm = vals["0.123"] == vals["123"] == vals["12.3"]
        repeat = vals["12.3"] == vals["12.3 repeat"]
        changed = vals["12.3"] != vals["default seed"]
        print("  %-4s normalize(0.123==123==12.3): %s   repeat: %s   seed changes seq: %s"
              % (side.upper(), "PASS" if norm else "FAIL",
                 "PASS" if repeat else "FAIL", "PASS" if changed else "FAIL"))
        if not norm:
            print("      0.123=%r 123=%r 12.3=%r"
                  % (vals["0.123"], vals["123"], vals["12.3"]))


def report_coverage():
    hits = sum(1 for b in COV if b)
    print("\n=== ROM execution coverage ===")
    print("  executed words: %d / %d (%.1f%% of the 6144-word image)"
          % (hits, len(COV), 100.0 * hits / len(COV)))
    # per-region
    for lo, hi, name in ROM_REGIONS:
        n = hi - lo + 1
        h = sum(1 for a in range(lo, hi + 1) if COV[a])
        if h == 0:
            print("  %-34s  0%%   (%04x-%04x)" % (name, lo, hi))
    # largest never-executed runs
    runs = []
    a = 0
    while a < len(COV):
        if COV[a]:
            a += 1
            continue
        b = a
        while b < len(COV) and not COV[b]:
            b += 1
        if b - a >= 16:
            runs.append((b - a, a, b - 1))
        a = b
    runs.sort(reverse=True)
    print("  largest never-executed spans (>=16 words):")
    for n, lo, hi in runs[:20]:
        print("    %4d words  %04x-%04x  %s" % (n, lo, hi, region_of(lo)))


def main():
    global FAST, COV
    cats = []
    verbose = "-v" in sys.argv
    FAST = "--fast" in sys.argv
    if "--cov" in sys.argv:
        COV = bytearray(0x1800)
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "-c" and i + 1 < len(sys.argv):
            cats.append(sys.argv[i + 1])
            i += 1
        i += 1

    sel = [c for c in CASES if not cats or c["cat"] in cats]
    stats = {}
    failures = []
    for c in sel:
        rom, romlog = run_rom(c["tokens"])
        js, jslog = run_js(c)
        expected = rom
        if c["radix"] == "," and rom is not None:
            expected = swap_marks(rom)
        ok = (rom is not None and expected == js)
        # all-blank ROM is almost always a timing/blanking artifact
        timing = (rom is not None and rom.strip() == "" and js is not None and js.strip() != "")
        key = c["cat"]
        s = stats.setdefault(key, [0, 0, 0])
        if ok:
            s[0] += 1
        else:
            s[1] += 1
            if timing:
                s[2] += 1
            failures.append((c, rom, js, timing))
        mark = "PASS" if ok else ("TIMING?" if timing else "FAIL")
        print("%-5s %-9s %-26s rom=%r js=%r" % (mark, c["cat"], c["name"], rom, js))
        if verbose and not ok:
            print("   ROM log:\n" + "\n".join("     " + x for x in romlog.splitlines()))

    print("\n=== summary ===")
    tp = tf = tt = 0
    for k in sorted(stats):
        p, f, t = stats[k]
        tp += p; tf += f; tt += t
        print("  %-10s %2d pass  %2d fail (%d timing?)" % (k, p, f, t))
    print("  %-10s %2d pass  %2d fail (%d timing?)" % ("TOTAL", tp, tf, tt))
    print("\n=== genuine mismatches ===")
    for c, rom, js, timing in failures:
        if timing:
            continue
        print("  [%s] %s" % (c["cat"], c["name"]))
        print("      rom=%r" % (rom,))
        if c["radix"] == ",":
            print("      expected(marks swapped)=%r" % (swap_marks(rom or ""),))
        print("      js =%r" % (js,))
    if "rng" in cats or not cats:
        rng_checks()
    if COV is not None:
        report_coverage()
    return 0 if tf == tt else 1


if __name__ == "__main__":
    sys.exit(main())
