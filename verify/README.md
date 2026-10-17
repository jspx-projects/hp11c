# HP-11C verification suite

Tools that run the **original HP-11C ROM** on the Nonpareil Nut/Voyager CPU
core and compare its LCD output, keystroke by keystroke, against the JS
reimplementation (`hp11c-engine.js`).

The ROM is the ground truth: it is executed on Eric Smith's Nonpareil
microcode-level simulator, but with the GTK front-end replaced by a small
headless driver, so it can be scripted and diffed automatically.

```
verify/
  Makefile            build everything
  src/headless.c      headless front-end for the Nonpareil sim core
  src/stubs.c         GUI/audio stubs (silent bender, dummy GUI chips)
  js_glass.js         drives hp11c-engine.js, prints LCD in glass format
  compare.py          small differential smoke suite
  audit.py            full differential suite (310 cases) + coverage mode
  AUDIT.md            audit method, findings and post-fix results
  bridge.py           drives the ROM-backed GUI from the browser
  hp11c-rom.html      ROM-backed GUI page
  hp11c-rom-adapter.js  Engine-compatible adapter for the ROM
  build/11c.ncd       generated model (ROM embedded), built by build_ncd
  bin/hp11c-sim       headless ROM simulator
  bin/build_ncd       Nonpareil .ncd model builder
```

`build/` and `bin/` are generated and are not committed.

## Dependencies

Build dependencies:

| package            | needed for                         |
|--------------------|------------------------------------|
| `gcc`, `make`      | build                              |
| `pkgconf`          | `pkg-config`                       |
| `glib2-devel`      | Nonpareil sim core (threads/queues) |
| `libxml2-devel`    | `.ncd` model parsing               |
| `node`             | `js_glass.js` (JS engine driver)   |
| `python3`          | `compare.py`                       |

```sh
sudo dnf install glib2-devel libxml2-devel     # Fedora
```

## One-command setup

From the repository root:

```sh
make -C verify deps
```

This runs `verify/fetch-deps.sh`, which clones Nonpareil at the pinned commit
(`c347bc1`, 2025-02-27), applies the optional fast/coverage patch, and builds
`bin/build_ncd` and `bin/hp11c-sim`.  Nonpareil's HP-11C model includes the ROM
(`ncd/11c/11c.rom`), so one checkout provides both the simulator and the ROM.

Options: `--no-patch`, `--no-build`, `--dest DIR`, `--ref COMMIT`; or
`make -C verify fetch` for fetch/checkout only.

This repository does **not** redistribute the HP-11C ROM or Nonpareil.  The ROM
is HP firmware; Nonpareil distributes it under CC BY-SA 2.5.  If you prefer your
own dump, put it at `nonpareil/ncd/11c/11c.rom` before building.

## Manual setup

Fetch Nonpareil yourself if you prefer:

```sh
git clone https://github.com/brouhaha/nonpareil.git nonpareil
git -C nonpareil checkout c347bc1ab20170c253512042f7aac0d952f304ea
```

## Manual build

From the repository root:

```sh
make -C verify ncd NONP=../nonpareil   # embed the ROM into build/11c.ncd
make -C verify NONP=../nonpareil       # build bin/build_ncd and bin/hp11c-sim
```

`NONP` defaults to `../nonpareil` relative to `verify/` (i.e. `./nonpareil` at
the repository root).  `make ncd` only needs to be re-run if the model or ROM
changes.

### Fast mode and coverage (optional patch)

`--fast` (turbo) and `--cov` need a small patch to the Nonpareil checkout:

```sh
git -C nonpareil apply verify/patches/nonpareil-verify.patch
make -C verify clean
make -C verify NONP=../nonpareil
```

The patch raises the simulator jiffy rate, adds the `NONPAREIL_TURBO`
multiplier, and adds the ROM PC-hit bitmap.  Without it the suite still builds
and runs correctly, in real time; `--fast` simply has no speedup and `--cov`
prints a warning.

## The headless ROM simulator (`bin/hp11c-sim`)

Links Nonpareil's Nut CPU (`proc_nut.c`), Voyager display chip
(`voyager_lcd.c`), model loader (`calcdef.c`) and simulator framework
(`proc.c`). It reads a line-oriented protocol on stdin:

```
<n>              press+release user keycode <n>
key <n>          same
hold <n> <ms>    press <n>, wait, release
wait <ms>        advance the simulation
dump             print the current LCD
reset            sim_reset()
bind 37 38 39    press a whole sequence
# comment
quit
```

User keycodes are the same "row\*10+col" numbers used in the model and in the
JS `POS` table (e.g. `37`=1, `36`=ENTER, `48`=decimal point, `42`=f, `43`=g,
`41`=ON). Each action prints one line:

```
<step> key=<n> glass=[ 12,345     ] ann=0x0 upd=... run=1
```

`glass` is position 0 (the dedicated minus column: `-` or space) followed by
the ten digit columns, left to right; a `.` or `,` is appended to the column
that carries it. Segment decode: a..g = bits 0..6, decimal point = h (bit 7),
comma = h+i together. `ann` is a bitmask of annunciator segments; `upd` is the
display-update counter (useful to confirm the CPU is actually running).

Options:

```
-n <ncd>        model file (default build/11c.ncd)
-f <script>     read commands from a file instead of stdin
-b <ms>         boot settle time (default 250)
--hold <ms>     key hold time (default 120)
--settle <ms>   post-key settle (default 220)
--fast          turbo: 200x real time, short holds, fast settle
settle <ms>     (script command) poll until the LCD is stable, max <ms>
down <n> / up <n>  (script commands) separate key press/release
HP11C_DEBUG_RAM=1   also dump display-chip RAM words 8..10
HP11C_DEBUG_LCD=1   dump the parsed LCD segment map
```

### Fast mode

`--fast` sets `NONPAREIL_TURBO=200`, raises the simulator jiffy rate (via the
optional `verify/patches/nonpareil-verify.patch`) and scales the key hold to 4 ms
(< 1 s of simulated time, so the firmware's held-SST/BST auto-repeat does not
add steps).  Results are cycle-identical to real-time mode; a full 184-case
audit drops from ~15 minutes to ~2 minutes.  `audit.py --fast` uses it and
`settle` instead of fixed waits.

The two-line Nonpareil patch is the only change to the vendored source: it
reads `NONPAREIL_TURBO` in `sim_init` and multiplies `words_per_usec`, and sets
`JIFFY_PER_SEC` to 1000.  With turbo unset the simulator still runs in real
time.

Example:

```sh
printf '41\nwait 400\n35\nwait 400\n37\n38\n39\nwait 1000\ndump\n' \
  | ./bin/hp11c-sim -n build/11c.ncd
```

Notes on timing: the simulator runs in real time at the model clock
(215 kHz). Keys must be held long enough for the firmware's keyboard scan
(a few tens of ms); very short taps can be missed. Slow operations
(`y^x`, Gamma, trig) blank the display while computing; allow ~1–2 s before
sampling.

## The JS driver (`js_glass.js`)

Drives the JS engine with a token sequence and prints the LCD in the same
`glass=[...]` format, so the two can be diffed:

```sh
node js_glass.js FIX4 1 2 3 4 5          # start at FIX 4 (ROM default)
node js_glass.js PLAIN 1 ENTER 3 DIV     # plain engine reset
```

Tokens are `f`, `g`, and the engine's LAYOUT key ids (`SQRT`, `EXP`, …, `0`,
`DOT`, `SIGMA`, `ADD`, `ENTER`, …). Prefixes are applied the same way the
browser view does (`layer = engine.prefix || "P"`).

## The differential tester (`compare.py`)

For every test it cold-boots the ROM, clears `Pr Error`, types the token
sequence, waits for slow operations to finish, and samples the LCD. It does
the same on the JS engine (reset to FIX 4 to match the ROM power-on default)
and compares the `glass` strings.

```sh
./compare.py          # run the battery
./compare.py -v       # dump ROM/JS logs for failing cases
```

To add a test, append `(name, "token sequence".split())` to the `tests` list
in `compare.py`. To point it at a different engine build, edit `js_glass.js`'s
`require(...)` path or set the binaries at the top of `compare.py`.

## The full audit (`audit.py`)

`audit.py` is the comprehensive differential suite (310 cases): display and
entry formatting, math/trig, statistics, storage, flags, errors, program
recording for every programmable key at plain/f/g, program execution, memory
allocation/Error 3, radix-comma, and the RNG seed self-checks.

```sh
python3 audit.py --fast          # ~3 minutes
python3 audit.py --fast --cov    # also report ROM PC-hit coverage
python3 audit.py --fast -c keys  # one family (display, entry, math, trig,
                                 # stats, storage, flags, program, errors,
                                 # mem, keys, radix, extra)
```

`--cov` uses the PC-hit bitmap in `proc_nut.c` (local verification build only)
to report how many of the 6144 ROM words the suite executes.

## How the comparison is framed

* Both sides are put into the **same display mode** (FIX 4) before each test.
  The ROM powers on in FIX 4; the JS engine defaults to FIX 2 — see
  `FINDINGS.md`.
* The ROM cold-boots with `Pr Error` (its Continuous Memory checksum fails
  with undefined RAM). The comparator presses a key to clear it first; this
  key press is consumed and does not act on the calculator, exactly as on
  real hardware.
* Only the LCD is compared here. Program-mode display, annunciator decoding,
  flags, and program-memory contents are not yet diffed (annunciator bits are
  reported in the `ann=` field for manual inspection).

## Driving the GUI with the ROM (`bridge.py`)

The existing browser GUI can be pointed at the real ROM instead of the JS
engine.  A small local bridge spawns `hp11c-sim` in streaming mode, serves the
GUI files, relays LCD frames to the browser over Server-Sent Events, and
forwards key presses back to the ROM.

```sh
cd verify
make
python3 bridge.py                 # then open http://localhost:8011/
```

Pieces:

* `--stream` mode of `bin/hp11c-sim` (in `src/headless.c`): emits a frame
  `glass=[...] ann=0x..` whenever the LCD changes and accepts `key <n>` /
  `hold <n> <ms>` / `reset` / `quit` on stdin.
* `bridge.py`: stdlib-only HTTP server.  `GET /events` is the SSE stream;
  `POST /key?n=<keycode>` presses a key; `/reset` and `/power` are helpers.
  Static files are served from the HP-11C directory, and `/rom/<file>` from
  `verify/`.
* `hp11c-rom-adapter.js` (`RomEngine`): a drop-in stand-in for `Engine` that
  implements only what `hp11c-view.js` uses.  `press()` posts keystrokes;
  `fmt()` parses the ROM’s `glass` string back into the same cell objects the
  view renderer expects.  Because the ROM already places every glyph in its
  physical column, no mantissa/exponent reconstruction is needed — blanks,
  decimal points, commas, exponent digits, `Error n` and program lines all
  render through the existing `renderNumberLCD` path.
* `hp11c-rom.html`: the GUI page; loads `engine.js` (for the segment geometry
  and `LEG`), then the adapter, then the unmodified view.

One tiny hook was added to `hp11c-view.js` (line 31):

```js
var engine=(typeof window!=="undefined"&&window.HP11C_ENGINE)?window.HP11C_ENGINE:new Engine();
```

so the same view file serves both the JS engine and the ROM.  Everything else
in the view is untouched.

Key mapping: the browser sends the same `(id, layer)` pairs as before; the
adapter translates them to user keycodes (f=42, g=43, otherwise the key’s
row*10+col position) — the same numbers in the model’s keyboard map and the
engine’s `POS` table.  Keys are held ~120 ms because the firmware keyboard scan
runs in real time.

**Cold boot.** The ROM starts with `Pr Error` because the simulated
Continuous Memory checksum fails on undefined RAM (a real calculator shows it
only after memory is lost).  The bridge powers the ROM on and clears it during
startup (one key press), and suppresses frames until then, so the GUI opens at
a clean `0.0000`.  Set `HP11C_BRIDGE_INIT=0` to disable.

**Annunciators.** The ROM’s annunciator bits are decoded and drive the GUI’s
annunciator row.  Empirically the Voyager LCD carries one annunciator bit per
glass column:

| glass column | legend on HP-11C |
|--------------|------------------|
| d2 | `USER` |
| d3 | `f` |
| d4 | `g` |
| d5 | `BEGIN` (sister models; never lit) |
| d6 | `GRAD`’s “G” |
| d7 | `RAD` |
| d8 | `D.MY` (never lit) |
| d9 | `C` (never lit) |
| d10 | `PRGM` |

`GRAD` mode lights d6+d7; `RAD` mode lights d7 only.  The low-battery `*` is a
hardware signal, not a simulated RAM bit, so it is still driven by the GUI’s
`lowbat` checkbox.

Limitations:

* The numeric inspector panel (stack, registers, flags) shows placeholders.
  These are internal ROM state the calculator never displays; exposing them
  would require reverse-engineering the Voyager RAM layout (the 40-word
  `data` memory) for the stack/register/flag map.
* The `f CLEAR PREFIX` mantissa-hold and held-SST/BST scrolling need true
  press/release events; the bridge currently sends a fixed ~120 ms hold per
  click, which is enough for ordinary keys.
* The display updates at the bridge poll rate (~15 ms) and the ROM runs in
  real time, so very slow operations (`y^x`, Gamma) briefly blank as they do
  on hardware.

## Licensing

`bin/hp11c-sim` and `bin/build_ncd` are built from Nonpareil sources
(GPL-2/GPL-3) and are development tools; they are not part of the JS emulator
distribution. `headless.c`, `stubs.c`, `js_glass.js`, `compare.py`, `bridge.py`
and `hp11c-rom-adapter.js` are the original glue added here.
