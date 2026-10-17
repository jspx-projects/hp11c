"use strict";
/*
 * js_glass.js - drive the JS HP-11C engine with a token sequence and print the
 *               resulting LCD as a "glass" string in the same format as the
 *               ROM simulator (hp11c-sim) so the two can be diffed.
 *
 * Usage:
 *   node js_glass.js [--init=FIX4|DEFAULT|FIX0..FIX9|SCI0..|ENG0..] \
 *                    [--radix=.|,] [--trig=DEG|RAD|GRAD] <token> ...
 *
 * Tokens: f g <keyname> ...   Keynames are engine LAYOUT ids
 *         (SQRT EXP TENX YX INV CHS 7 8 9 DIV SST GTO SIN COS TAN EEX
 *          4 5 6 MUL RS GSB RDN SWAP BACK ENTER 1 2 3 SUB ON STO RCL
 *          0 DOT SIGMA ADD)
 */

var path = require("path");
global.window = {};
require(path.join(__dirname, "..", "hp11c-engine.js"));
var Engine = global.window.Engine;
var e = new Engine();

var init = "FIX4", radix = ".", trig = null;
var tokens = [];
for (var ai = 2; ai < process.argv.length; ai++) {
    var a = process.argv[ai];
    if (a.indexOf("--init=") === 0) init = a.slice(7);
    else if (a.indexOf("--radix=") === 0) radix = a.slice(8);
    else if (a.indexOf("--trig=") === 0) trig = a.slice(7);
    else tokens.push(a);
}

e.reset();
if (trig) e.trigMode = trig;
if (init !== "DEFAULT") {
    var m = init.match(/^(FIX|SCI|ENG)(\d)$/);
    if (m) e.display = { mode: m[1], n: +m[2] };
}
if (radix === ",") { e.radix = ","; e.sep = "."; }
else { e.radix = "."; e.sep = ","; }

for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t === "f") { e.press("F", "P"); continue; }
    if (t === "g") { e.press("G", "P"); continue; }
    var layer = e.prefix || "P";
    e.press(t, layer);
    if (e.release) e.release();   /* release momentary states (MEM) */
}

/* ---- build glass: pos0 sign, pos1..10 = view slots 0..9 ---- */
function render(slots, minus) {
    var out = minus ? "-" : " ";
    for (var i = 0; i < 10; i++) {
        var s = slots[i];
        out += (s.ch && s.ch !== " ") ? s.ch : " ";
        /* dot = radix mark, comma = digit separator; glyphs follow the mode */
        if (s.dot) out += (e.radix === "," ? "," : ".");
        if (s.comma) out += (e.sep === "." ? "." : ",");
    }
    return out;
}

function fmt_cells_to_glass(f) {
    var slots = [], i;
    for (i = 0; i < 10; i++) slots.push({ ch: " ", dot: 0, comma: 0 });

    if (f.error != null) {
        /* ROM: "Error" + blank + digit (7 glyphs, d2..d8) */
        var word = ["E", "r", "r", "o", "r", " ", String(f.error % 10)];
        var start = Math.floor((10 - word.length) / 2);
        for (i = 0; i < word.length; i++) slots[start + i].ch = word[i];
        return render(slots, false);
    }
    if (f.prError) {
        var pw = ["P", "r", " ", "E", "r", "r", "o", "r"];
        var ps = Math.floor((10 - pw.length) / 2);
        for (i = 0; i < pw.length; i++) if (pw[i] !== " ") slots[ps + i].ch = pw[i];
        return render(slots, false);
    }
    if (f.program) {
        var pc = f.cells || [];
        for (i = 0; i < 10 && i < pc.length; i++) {
            slots[i].ch = (pc[i].d != null) ? pc[i].d : " ";
            /* program three-key separators use the digit separator glyph */
            if (pc[i].dot) slots[i].comma = 1;
        }
        return render(slots, false);
    }

    var cells = f.cells || [];
    var minus = false, man = [], expSign = false, expD = [], hasGap = false, phase = "man";
    for (i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (c.gap) { hasGap = true; phase = "exp"; }
        else if (c.sign) minus = true;
        else if (c.es) expSign = true;
        else if (c.ed != null) expD.push(c.ed);
        else if (c.d != null) {
            if (phase === "man") man.push({ ch: c.d, dot: !!c.dot, comma: !!c.comma });
            else expD.push(c.d);
        }
    }
    if (hasGap) {
        var m = man.slice(0, 7);
        for (i = 0; i < m.length; i++) { slots[i].ch = m[i].ch; slots[i].dot = m[i].dot; slots[i].comma = m[i].comma; }
        slots[7].ch = expSign ? "-" : " ";
        var ed = expD.slice();
        while (ed.length < 2) ed.unshift("0");
        if (ed.length > 2) ed = ed.slice(ed.length - 2);
        slots[8].ch = ed[0]; slots[9].ch = ed[1];
    } else {
        var m2 = man.slice(0, 10);
        for (i = 0; i < m2.length; i++) { slots[i].ch = m2[i].ch; slots[i].dot = m2[i].dot; slots[i].comma = m2[i].comma; }
    }
    return render(slots, minus);
}

process.stdout.write("glass=[" + fmt_cells_to_glass(e.fmt()) + "]\n");
