"use strict";
/*
 * hp11c-rom-adapter.js
 *
 * A drop-in replacement for the JS Engine that is backed by the real HP-11C
 * ROM running on the Nonpareil Nut core (see bridge.py / bin/hp11c-sim).
 *
 * The existing browser GUI (hp11c-view.js) is written against a handful of
 * Engine members.  This object implements just those, so the same rendering
 * and input code drives the ROM:
 *
 *   press(id, layer)      forward a keystroke to the ROM (via the bridge)
 *   effective(id, layer)  always null -> the ROM handles all key semantics
 *   fmt()                 decode the ROM's LCD segments into view cells
 *   prefix / programMode / running / etc.  display/input state mirrors
 *
 * LCD frames arrive from the bridge as Server-Sent Events carrying
 * `glass=[...] ann=0x..`, exactly the format the headless simulator prints.
 * The glass string is parsed back into the cell list the view renderer wants;
 * because the ROM places every glyph at its physical column, no logical
 * (mantissa/exponent) reconstruction is needed.
 */

(function () {
    // id -> user keycode (= engine POS / ncd user_keycode), built from LEG.
    var POS = { ENTER: 36 };
    (function () {
        var grid = (window.LEG && window.LEG.grid) || [];
        for (var r = 0; r < grid.length; r++) {
            for (var c = 0; c < grid[r].length; c++) {
                var cell = grid[r][c];
                if (!cell) continue;
                POS[cell.id] = (r + 1) * 10 + ((c + 1) === 10 ? 0 : (c + 1));
            }
        }
    })();

    function parseGlass(glass) {
        var cells = [];
        if (!glass) return cells;
        if (glass.charAt(0) === "-") cells.push({ sign: 1 });
        var i = 1;
        for (var col = 0; col < 10; col++) {
            if (i >= glass.length) { cells.push({ d: " " }); continue; }
            var ch = glass.charAt(i++);
            var dot = false, comma = false;
            while (i < glass.length && (glass.charAt(i) === "." || glass.charAt(i) === ",")) {
                if (glass.charAt(i) === ".") dot = true; else comma = true;
                i++;
            }
            var cell = { d: ch === " " ? " " : ch };
            if (dot) cell.dot = 1;
            if (comma) cell.comma = 1;
            cells.push(cell);
        }
        return cells;
    }

    function RomEngine(url) {
        this.url = url || "";
        this.prefix = null;
        this.programMode = false;
        this.running = false;
        this.mantissa = false;
        this.off = false;
        this.previewLine = null;
        this.error = null;
        this.prError = false;
        this.lowbat = false;
        this.user = false;
        this.trigMode = "DEG";
        this.radix = ".";
        this.sep = ",";
        this.display = { mode: "ROM", n: 0 };
        this.t = 0; this.z = 0; this.y = 0; this.x = 0;
        this.lastX = 0; this.I = 0; this.pc = 0;
        this.reg = [];
        for (var i = 0; i < 20; i++) this.reg[i] = 0;
        this.liftEnabled = false;
        this.lastKey = "";
        this.lastBuf = "";
        this.glass = "";
        this.ann = 0;
        this.connected = false;
        this._connect();
    }

    RomEngine.prototype._connect = function () {
        var self = this;
        if (typeof EventSource === "undefined") return;
        var es = new EventSource(this.url + "/events");
        this._es = es;
        es.onopen = function () {
            self.connected = true;
            if (window.__boot) window.__boot("ROM bridge connected");
            if (window.render) window.render();
        };
        es.onerror = function () {
            self.connected = false;
            if (window.render) window.render();
        };
        es.onmessage = function (ev) {
            try {
                var f = JSON.parse(ev.data);
                self.glass = f.glass;
                self.ann = f.ann;
                self._applyAnn();
                if (window.render) window.render();
            } catch (e) { /* ignore */ }
        };
    };

    /*
     * Annunciator bits.  The Voyager LCD carries one annunciator bit ('j'
     * segment) per glass column; empirically, mapping the ROM's bits out:
     *   d2 USER   d3 f   d4 g   d5 BEGIN   d6 GRAD("G")   d7 RAD
     *   d8 D.MY   d9 C   d10 PRGM
     * '*' (low battery) is not a RAM bit on this chip; GRAD lights d6+d7 and
     * RAD lights d7 only (GRAD is a two-part "G"+"RAD" legend).  BEGIN,
     * D.MY and C are sister-model legends and never light on the HP-11C.
     */
    RomEngine.prototype._applyAnn = function () {
        var a = parseInt(this.ann, 16) || 0;
        this.annBits = a;
        this.user = !!(a & (1 << 2));
        this.programMode = !!(a & (1 << 10));
        this.trigMode = (a & (1 << 6)) ? "GRAD" : ((a & (1 << 7)) ? "RAD" : "DEG");
        this.prefix = (a & (1 << 3)) ? "f" : ((a & (1 << 4)) ? "g" : null);
    };

    RomEngine.prototype._post = function (path) {
        try { fetch(this.url + path, { method: "POST" }); } catch (e) { /* ignore */ }
    };

    RomEngine.prototype.press = function (id, layer) {
        this.lastKey = id + "/" + (layer || "P");
        if (id === "F") { this.prefix = "f"; this._post("/key?n=42"); return; }
        if (id === "G") { this.prefix = "g"; this._post("/key?n=43"); return; }
        var n = POS[id];
        if (n == null) return;
        this.prefix = null;
        this._post("/key?n=" + n);
    };

    // The ROM owns all key semantics; nothing to pre-compute here.
    RomEngine.prototype.effective = function () { return null; };

    RomEngine.prototype.nextRunLine = function () { return 0; };

    /* The ROM owns all momentary state; the view still calls release(). */
    RomEngine.prototype.release = function () {};

    RomEngine.prototype.fmt = function () {
        if (this.off) return { cells: [] };
        return { cells: parseGlass(this.glass) };
    };

    RomEngine.prototype.reset = function () { this._post("/reset"); };
    RomEngine.prototype.serialize = function () { return { rom: true }; };
    RomEngine.prototype.restore = function () { /* no-op */ };

    window.RomEngine = RomEngine;
    window.parseGlassFrame = parseGlass;
})();
