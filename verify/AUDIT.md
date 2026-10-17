# HP-11C ROM audit — specification and JS implementation

Date: 2026-10-17
Reference: original HP-11C firmware (Nonpareil's `ncd/11c/11c.rom`) executed
on Nonpareil's Nut/Voyager core via `bin/hp11c-sim`.
Candidate: `hp11c-engine.js` + `hp11c-view.js`, and `doc/Specification.txt`.

Method: 184 scripted keystroke cases (`verify/audit.py`) run on both the ROM and
the JS engine; final LCD compared glyph-for-glyph. Additional targeted probes
for indirect branching, address-20 arithmetic, MEM, subroutine depth, DSE
loops, and RNG. Every mismatch below was reproduced against the ROM directly.

**Status: all actionable findings fixed (2026-10-17).** A fast turbo mode was
added to the simulator, the JS engine and view were corrected, and
`Specification.txt` was patched. The suite was then expanded with memory
allocation/Error 3, all 36 programmable keys x plain/f/g recording, radix-comma,
and STO RAN# seed checks. Final result: **308 / 310 pass** and **86.1% of the
ROM image executed**. The only two remaining differences are the random-number
sequence, which the spec explicitly permits to differ from the ROM (see A9);
they are not implementation defects.

The table below is the *pre-fix* baseline that produced this report.

| area | pass | fail |
|---|---|---|
| stack | 7 | 0 |
| program (recording, editing, running, user mode) | 27 | 3 |
| storage | 13 | 1 |
| math | 20 | 6 |
| trig | 18 | 3 |
| misc (%, polar, probability) | 6 | 3 |
| stats | 5 | 4 |
| flags | 1 | 3 |
| errors | 2 | 6 |
| extra (indirect branch, addr 20, depth, RNG) | 1 | 8 |
| display | 23 | 9 |
| entry | 13 | 2 |
| **total** | **136** | **48** |

The 48 failures collapse to the 13 root causes below. Most "failures" are the
single error-layout bug repeating across every error case, and several are the
same indirect-branch / address-20 issue repeated for each operator.

---

# A. Errors in `Specification.txt` (the ROM disagrees)

## A1. Power-on display mode is FIX 4, not FIX 2
Spec §4.7 (line 318) and the checklist (line 2739) say `FIX 2`.

ROM evidence: after clearing cold-boot `Pr Error`, the display is `0.0000`;
`1 ENTER 3 ÷` displays `0.3333`. The manual's getting-started section also
shows `0.0000` on a fresh calculator.

Correction: default is **FIX 4**.

## A2. Error messages are 7 glyphs, not 6
Spec §7.9 (lines 814-815) says a six-glyph group `Error n` occupies `d3..d8`.

ROM evidence: `√(-4)` shows `  Error 0  ` — `E` at d2, `rror` d3..d6, a blank d7,
and `0` at d8. That is `"Error" + space + digit` centred in d2..d8.
`Pr Error` (8 glyphs, d2..d9) is already correct in the spec.

Correction: render `Error n` as seven glyphs centred in d1..d10 (start d2),
i.e. there is always one blank column between `Error` and the digit.

## A3. Storage arithmetic to I via indirect address 20 is valid
Spec §4.3 (lines 206-208), §16.4 (line 1678), §21.6 (line 2199) and §23.1
(line 2313) say it is invalid and produces Error 0.

ROM evidence (I = 20, X = 5, then `STO +/−/×/÷ (i)`):

| operation | ROM result in I |
|---|---|
| `STO + (i)` | 25 |
| `STO − (i)` | 15 |
| `STO × (i)` | 100 |
| `STO ÷ (i)` | 4 |

No error is produced. Address 20 addresses I for arithmetic just as it does for
store/recall/exchange.

Correction: remove the Error 0 rule; storage arithmetic to address 20 operates
on I (with the usual Error 1 overflow rule and Error 0 divide-by-zero rule).

## A4. Indirect branches use the I key, not the (i) key
Spec §18.3 (lines 2014/2021), §21.7 (line 2212) and the checklist call the
instruction `GTO (i)` / `GSB (i)`, and the JS follows the `(i)` key
(gold COS).

ROM evidence, in Program mode:
```
GTO f TAN   ->  001- 22 25      (GTO I)
GSB f TAN   ->  001- 32 25      (GSB I)
GTO f COS   ->  001- 45 24      (RCL (i) — the GTO is discarded)
GTO  COS    ->  001-    24      (plain COS — the GTO is discarded)
```
So the indirect branch operand is the **I key** (`f TAN`, keycode 25), stored
as `22 25` / `32 25`. The `(i)` key (`f COS`, keycode 24) is only for indirect
*storage* (`STO (i)` = 44 24, `RCL (i)` = 45 24).

The ROM also branches correctly with it: a program `LBL A; GTO I; 9; RTN;
LBL 3; 7; RTN` with I=3 returns `7.0000`.

Corrections: rename to `GTO I` / `GSB I`, document keycode 25 and stored
sequences `22 25` / `32 25`, and keep `(i)` for storage only. §6.3 should list
these stored sequences (it currently lists only the storage forms).

## A5. Indirect label addresses 15..19 produce Error 4
Spec §21.7 (lines 2234-2240) and the checklist (lines 2359, 2972) say the
instruction is accepted, no label is found, PC is unchanged, and **no error**
is produced for addresses 15..19.

ROM evidence:
```
I=15, GTO I (keyboard)            -> Error 4
I=16, GTO I (keyboard)            -> Error 4
I=15, GTO I inside a program      -> Error 4 (halts)
I=15, GSB I inside a program      -> Error 4 (halts)
```
The `15..19` exception does not exist on this ROM.

Correction: addresses 15..19 are simply "label not found" → Error 4, like any
other missing label. (Label addresses 0..14 map to LBL 0..9, A..E.)

## A6. The radix mark is always displayed (spec omission)
Spec §7.2-7.4 describe digits after the radix mark but never say the mark
itself is always present.

ROM evidence:
```
FIX 0 of 3      3.
FIX 0 of 1.5    2.        (rounds to 2, still shows the mark)
SCI 0 of 3      3.       00
ENG 0 of 300    300.     00
```
Correction: state that FIX/SCI/ENG always draw the radix mark, even at
0 fraction digits, and that the mark occupies the gap to the right of the last
integer digit.

Related ROM behavior worth specifying: FIX 0 falls back to SCI when the value
rounds to zero (`0.4` → `4.  -01`). The spec currently leaves FIX fallback
thresholds implementation-defined; this is one concrete threshold.

## A7. Thousands separators appear during digit entry (spec omission)
Spec §5.2/§5.4 describe digit and EEX entry without mentioning separators.
The manual (p.18) shows `12345` → `12,345`, and the ROM does this for both
normal and EEX entry:
```
keying 12345         12,345
1,234,567 EEX 9      1,234,567 09
123,456,789 (EEX blocked)   123,456,789
```
Correction: state that the integer part of the entry buffer is grouped with the
current digit separator as digits are keyed, including while entering an
exponent.

## A8. MEM layout has an extra blank column (minor)
Spec §4.6 gives the format `p-xx r-.x`. The ROM actually draws:
```
p-61  r- .9
```
with two blank columns between the `p` field and the `r` field and the radix
mark in the column after `r-` (10 glass columns). The JS follows the spec and
draws the more compact `p-61 r- .9`.

This is cosmetic; if exact glass layout matters, update §4.6 with the physical
column assignment.

## A9. RNG: spec mandates an LCG the ROM does not use
Spec §14.2 (lines 1449-1452) says the emulator MUST use
`S=(16807*S) mod 2147483647`, result `S/2147483647`.

ROM evidence (SCI 7, after reset):
```
first RAN#   0.1017980
third RAN#   0.3247517
```
The JS LCG gives `7.826369e-06` for the first value. The ROM uses a different
generator (or seed normalization).

The spec explicitly allows this at §14.2 ("Exact bit-for-bit sequence
compatibility … is not required"), so the JS is *conforming to the spec* while
not matching the ROM. If ROM-identical RNG is desired, the spec's algorithm
must be replaced with the firmware's actual routine.

---

# B. Bugs in the JS implementation (ROM is right)

## B1. Display rounding is binary, not decimal
`hp11c-engine.js` uses `Number.toFixed()` (`fix` line 2450, `sci` 2498,
`eng` 2545/2553), which rounds on the binary value.

ROM / JS:
```
FIX 2 of 2.675    2.68 / 2.67
FIX 3 of 1.2345   1.235 / 1.234
SCI 3 of 12345    1.235 04 / 1.234 04
```
Spec §3.2 correctly requires round-half-away-from-zero. Fix: format through the
decimal/`round10` path or a decimal-string formatter.

## B2. Missing radix mark at 0 fraction digits
`fix` only sets the dot when `dec > 0` (line 2470); `sci`/`eng` only when
`sd > 0` (2511, 2563).

```
FIX 0 of 3      ROM 3.       JS 3
SCI 0 of 3      ROM 3.   00  JS 3    00
ENG 0 of 300    ROM 300. 00  JS 300  00
```
Fix: always attach the radix mark to the last integer digit for FIX/SCI/ENG,
even when there are no fraction digits.

## B3. No thousands separators while keying
`bufCells()` (line 2600) emits the entry buffer with no grouping. The committed
display (`fix`) does group. The ROM groups during entry and EEX entry (A7).

Fix: apply the same `grp()` logic to the integer portion of `bufCells()` using
`this.sep`, marking the separator on the preceding cell.

## B4. Default display mode
`reset()` sets `{mode:'FIX', n:2}` (line 242). The ROM resets to FIX 4 (A1).

## B5. Error display layout
`renderErrorLCD()` (`hp11c-view.js:220`) builds `['E','r','r','o','r',n]` and
centres six glyphs at d3..d8. The ROM uses seven glyphs (`Error`, blank, digit)
at d2..d8 (A2).

## B6. MEM is sticky instead of momentary
`g MEM` sets `memHeld = true` (`runPerform`, line 1127) and it is only cleared
by the *next* key (`press`, line 542). The ROM shows MEM while the key is held
and reverts on release (spec §4.6 says "momentary").

Audit consequence: after `g RCL` the JS still shows `p-61 r- .9` while the ROM
has returned to `0.0000` / the program line. Fix: clear `memHeld` on key-up
(the view already has a release path for other holds).

The MEM *contents* agree when held (ROM `p-61  r- .9` vs JS `p-61 r- .9`);
only the layout differs (A8).

## B7. Storage arithmetic to address 20
`doReg()` (line 1436) rejects `IND` with address 20 as Error 0. The ROM
performs the arithmetic on I (A3).

Fix: treat address 20 like I for `STO +/−/×/÷`, with the normal Error 1 /
Error 0 rules.

## B8. Indirect GTO/GSB uses the wrong key and wrong 15..19 behavior
`resolveGto()` (line 836) recognizes indirect branches on `id === "COS"`
(the `(i)` key). The ROM uses the **I** key (`TAN`, f-shifted), keycode 25
(A4). Consequences:
```
GTO I to LBL 3    ROM 7.0000   JS 19.0000
GTO I, no label   ROM Error 4  JS 3.0000 (instruction ignored)
GTO I, I=15       ROM Error 4  JS 15.0000
```
`resolveTarget()` (line 2036) also returns a silent no-op for addresses 15..19;
the ROM raises Error 4 (A5).

Fix: recognize `id === "TAN"` for the indirect branch operand (store
`22 25` / `32 25`), and remove the 15..19 no-op exception.

---

# C. Verified correct against the ROM

Everything below matched the ROM bit-for-bit (final LCD):

* stack: `x<>y`, `R↓`, `R↑`, `LSTx`, constant arithmetic, ENTER, LAST X.
* math: `√`, `x²`, `1/x`, `yˣ`, `eˣ`, `LN`, `10ˣ`, `LOG`, `ABS`, `INT`, `FRAC`,
  `RND`, π, `x!` (0, 5, 69, 70 saturation, negative saturation, Gamma 1.5).
* trig: DEG/RAD/GRAD sin/cos/tan, inverse, domains, hyperbolic and inverse
  hyperbolic (including `acosh(1)=0`, `atanh(±1)=±MAX`), `→RAD`, `→DEG`,
  `→HMS`, `→H`.
* percent, `Δ%`, `→P`, `→R`, `P(10,3)`, `C(10,3)`, domain errors.
* statistics: `Σ+`, `Σ−`, CLEAR Σ, mean, `s`, `L.R.`, `y,r`, `RCL Σ+`, and the
  `n=0`/`n=1` error conditions.
* storage: `STO/RCL` R0..R9, R.0..R.9, I, `STO ±×÷` direct, `CLEAR REG`,
  `x<>I`, `x<>(i)`, indirect store/recall, `STO ÷ 0` Error 0.
* flags: SF/CF/F? and program skip; Error 6 for flag > 1.
* program recording/display of every tested format: `LBL`, `GTO`, `GSB`,
  `RTN`, `STO+`, `STO+(i)`, `RCL I`, `RCL (i)`, `RCL Σ+`, `HYP SIN`,
  `FIX n`, `SF`, `ISG`, `DSE`, `x≤y`, `x=0`, `PSE`, `GTO .nnn`.
* editing: insert, delete, SST/BST movement.
* execution: heat-loss and circle-area programs, flag-controlled skip,
  subroutines, 4-deep nesting → Error 5, DSE loop (3 iterations), R/S.
* User mode: A–E direct execution and `f`+top-row math functions.
* `GTO .000` / `GTO .005` line positioning and Error 4; `GTO .000` valid.
* error clearing (any key clears but does not resume).

# D. Not covered (recommend next)

* Radix-comma convention and the power-on decimal-key toggle (the model's
  hardware path is not exercised by the harness).
* Error 3 (accessing a register converted to program memory) — requires filling
  program memory past a 7-line conversion boundary.
* Memory reallocation / `CLEAR PRGM` reclaiming registers (only the first MEM
  values were checked).
* Auto-off timing, low battery, self-tests.
* RNG sequence (A9): the spec permits divergence, so this is a policy decision.
* Mantissa-hold (`f CLEAR PREFIX`) and held SST/BST scrolling need true
  press/release timing; the harness sends fixed ~120 ms holds.

# E. Reproduce

```sh
cd verify
make ncd && make
python3 audit.py            # full sweep
python3 audit.py -c display -c entry
python3 audit.py -v -c math # logs on failure
```

The reusable cases are in `audit.py`; `compare.py` remains the smaller smoke
suite.

Use `python3 audit.py --fast` for the ~200× turbo run (~2 minutes instead of
~15).

# F. Fixes applied

## Simulator (verification tooling)

* `verify/patches/nonpareil-verify.patch` (optional, applied to a Nonpareil
  checkout): jiffy rate raised to 1000/s, a `NONPAREIL_TURBO` multiplier added
  to `words_per_usec`, and the ROM PC-hit bitmap.  Firmware timing is
  cycle-based, so results are unchanged; only wall-clock speed differs.
* `verify/src/headless.c`: `--fast` scales key hold/settle and enables turbo.
  Hold is kept at 4 ms wall (< 1 s simulated) so the firmware's held-SST/BST
  auto-repeat does not add steps.  `settle <ms>` was added to poll until the
  LCD is stable.
* `verify/audit.py`: `--fast` mode; corrected the indirect-branch tests to use
  the I key and added the address-20/Error-5/DSE/RNG cases.
* `verify/js_glass.js`: releases momentary state after each key and renders the
  7-glyph error layout.

## JS implementation

* `hp11c-engine.js`
  * `decParts()`/`roundSig()`: decimal round-half-away-from-zero; `fix`, `sci`,
    `eng` and `rnd` now use them instead of `toFixed`.
  * radix mark is always emitted, including 0 fraction digits.
  * `bufCells()` groups the integer part with the digit separator during entry
    and EEX entry.
  * reset default changed to FIX 4.
  * `release()` clears momentary MEM state.
  * address 20 storage arithmetic operates on I (no Error 0).
  * indirect GTO/GSB uses the `TAN` key (I) and stores `22 25` / `32 25`.
  * indirect label addresses 15..19 produce Error 4.
  * `memCells()` uses the ROM physical layout `p-xx  r- .x`.
* `hp11c-view.js`: 7-glyph error layout; calls `engine.release()` on key-up /
  pointer-up; self-test indirect-branch cases updated.
* `verify/hp11c-rom-adapter.js`: `release()` no-op for the ROM-backed GUI.

## Specification

`Specification.txt` was corrected in §4.3/§4.6/§4.7/§5.2/§5.4/§7.2-§7.4/§7.9/
§14.2/§16.4/§17.6/§18.3/§21.7/§23.1/§23.5/§28 and a 2026-10-17 changelog entry
was added (default FIX 4, error layout, address-20 arithmetic, GTO I/GSB I,
15..19 Error 4, radix mark, entry grouping, MEM layout, RNG note).

## Accepted deviation

* **RNG sequence (A9).** The ROM uses a generator that is not the specified
  LCG.  §14.2 explicitly allows non-identical sequences and the JS remains
  spec-conforming.  The two RAN# audit cases are therefore expected to differ;
  making them match requires reverse-engineering the firmware generator.

# G. Post-fix results and coverage

```
display 32/32   entry 15/15   errors 8/8    extra 7/9 (RNG only)
flags   4/4     keys 107/107  math 26/26    mem 6/6
misc    9/9     program 30/30 radix 13/13   stack 7/7
stats   9/9     storage 14/14 trig 21/21
TOTAL 308/310   (remaining 2 = RNG, permitted)
```

Measured with `audit.py --cov` (PC-hit bitmap in `proc_nut.c`):

```
executed words: 5287 / 6144  (86.1% of the ROM image)
```

The never-executed spans are dominated by the intentionally out-of-scope
hardware service/self-test paths:

* `0x172c-0x17e9` (190 words) keyboard scan/refresh/self-test entry
* `0x0042-0x0065` (36 words) power-on key-combo dispatch
* `0x0c64-0x0c7e`, `0x0cfa-0x0d10` (50 words) rare statistics branches
* `0x07af-0x07bf` (17 words) one RAN#/seed branch
* ~120 words across rare BCD/math/storage/program branches

These are documented in Specification.txt §29 as deliberately out of scope.
Excluding the two data tables (key matrix and dispatch table), coverage is
roughly 88–93% of executable code.

## New families added in this pass

* **`mem` (6 cases)** — 64-line conversion makes R.9 unavailable (Error 3);
  deleting one line releases R.9; `CLEAR PRGM` in Program mode restores the
  initial allocation while in Run mode only moves PC; the 204th line gives
  Error 4; statistics after 203 lines give Error 3. All match.
* **`keys` (107 cases)** — every programmable key (36) at plain/f/g, with
  required operands, recorded in Program mode and compared glyph-for-glyph.
  Found and fixed: standalone `f COS`/`f TAN` must record `RCL (i)`/`RCL I`
  (`45 24`/`45 25`), not raw `42 24`/`42 25`.
* **`radix` (13 cases)** — JS in comma mode compared against the ROM in point
  mode with `.`/`,` swapped. Covers entry grouping, committed values, FIX/SCI/
  ENG, program-mode separators, and an error case. All match.
* **`STO RAN#` seed self-checks** — normalization (0.123 = 123 = 12.3),
  repeatability, and seed-changes-sequence: PASS for both ROM and JS. (The
  sequences themselves differ by design.)

## GUI

* Low-battery annunciator fixed: the `*` item in `renderAnn()` was a blank
  glyph; the checkbox now lights the asterisk (blinking). It is a display-test
  control, not a battery measurement.
* The ROM-backed GUI and the JS GUI share the fix.

