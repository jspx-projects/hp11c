"use strict";
/* =========================================================================
   hp11c-engine.js - HP-11C reimplementation (DOM-free core)
   Regenerated consolidated engine.
   Updated against Specification.txt (2026-08-03):
     - RCL Sigma+ (spec 15.9) added, programmable, keycode 45 49
     - x-bar / s / L.R. / RCL Sigma+ use the two-value recall stack model
       (T <- old Y, Z <- old X) per spec 15.4/15.5/15.7/15.9
   ========================================================================= */

/* ---- physical layout (row x col); col index 9 (10th) -> keycode digit 0 ---- */
const LAYOUT = [
    ['SQRT', 'EXP', 'TENX', 'YX', 'INV', 'CHS', '7', '8', '9', 'DIV'],
    ['SST', 'GTO', 'SIN', 'COS', 'TAN', 'EEX', '4', '5', '6', 'MUL'],
    ['RS', 'GSB', 'RDN', 'SWAP', 'BACK', null, '1', '2', '3', 'SUB'],
    ['ON', 'F', 'G', 'STO', 'RCL', null, '0', 'DOT', 'SIGMA', 'ADD']
];
const SPAN = ['ENTER'];

/* ---- action tokens per layer (P=white, f=gold, g=blue) ---- */
const ACT = {
    SQRT:  { P: 'sqrt',  f: 'runA',     g: 'sq' },
    EXP:   { P: 'exp',   f: 'runB',     g: 'ln' },
    TENX:  { P: 'tenx',  f: 'runC',     g: 'log' },
    YX:    { P: 'yx',    f: 'runD',     g: 'pct' },
    INV:   { P: 'inv',   f: 'runE',     g: 'deltapct' },
    CHS:   { P: 'chs',   f: 'pi',       g: 'abs' },
    '7':   { P: 'd7',    f: 'FIX',      g: 'DEG' },
    '8':   { P: 'd8',    f: 'SCI',      g: 'RAD' },
    '9':   { P: 'd9',    f: 'ENG',      g: 'GRAD' },
    DIV:   { P: 'div',   f: 'cLE',      g: 'cL0' },
    SST:   { P: 'SST',   f: 'LBL',      g: 'BST' },
    GTO:   { P: 'GTO',   f: 'HYP',      g: 'HYPINV' },
    SIN:   { P: 'sin',   f: 'XEXI',     g: 'asin' },
    COS:   { P: 'cos',   f: 'IND',      g: 'acos' },
    TAN:   { P: 'tan',   f: 'Iop',      g: 'atan' },
    EEX:   { P: 'EEX',   f: 'TOR',      g: 'TOP' },
    '4':   { P: 'd4',    f: 'XSWAPI',   g: 'SF' },
    '5':   { P: 'd5',    f: 'DSE',      g: 'CF' },
    '6':   { P: 'd6',    f: 'ISG',      g: 'FQ' },
    MUL:   { P: 'mul',   f: 'cGT',      g: 'cG0' },
    RS:    { P: 'RS',    f: 'PSE',      g: 'PR' },
    GSB:   { P: 'GSB',   f: 'CLRSIGMA', g: 'RTN' },
    RDN:   { P: 'rdn',   f: 'CLRPRGM',  g: 'rup' },
    SWAP:  { P: 'swap',  f: 'CLRREG',   g: 'rnd' },
    BACK:  { P: 'back',  f: 'CLRPFX',   g: 'clx' },
    '1':   { P: 'd1',    f: 'PYX',      g: 'CYX' },
    '2':   { P: 'd2',    f: 'HMS',      g: 'TOH' },
    '3':   { P: 'd3',    f: 'TORAD',    g: 'TODEG' },
    SUB:   { P: 'sub',   f: 'cNE',      g: 'cN0' },
    ON:    { P: 'on',    f: null,       g: null },
    F:     { P: 'prefF', f: null,       g: null },
    G:     { P: 'prefG', f: null,       g: null },
    STO:   { P: 'sto',   f: 'frac',     g: 'int' },
    RCL:   { P: 'rcl',   f: 'USER',     g: 'MEM' },
    '0':   { P: 'd0',    f: 'fact',     g: 'MEAN' },
    DOT:   { P: 'dot',   f: 'YR',       g: 's' },
    SIGMA: { P: 'sigma', f: 'LR',       g: 'sigmam' },
    ADD:   { P: 'add',   f: 'cEQ',      g: 'cE0' },
    ENTER: { P: 'enter', f: 'RAN',      g: 'lstx' }
};

const TOPROW = { SQRT: 'A', EXP: 'B', TENX: 'C', YX: 'D', INV: 'E' };
const TOPMATH = {
    SQRT: 'sqrt',
    EXP: 'exp',
    TENX: 'tenx',
    YX: 'yx',
    INV: 'inv'
};

const LABEL_OF = {
    SQRT: 'A', EXP: 'B', TENX: 'C', YX: 'D', INV: 'E',
    '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
    '5': '5', '6': '6', '7': '7', '8': '8', '9': '9'
};
const LABEL_KEY = { A: 'SQRT', B: 'EXP', C: 'TENX', D: 'YX', E: 'INV' };

const TRIG_BASE = { SIN: 'sin', COS: 'cos', TAN: 'tan' };

const DIGIT = {
    '0': 1, '1': 1, '2': 1, '3': 1, '4': 1,
    '5': 1, '6': 1, '7': 1, '8': 1, '9': 1
};

const ARITH = { ADD: '+', SUB: '-', MUL: '*', DIV: '/' };

const ENTRY = {
    d0: 1, d1: 1, d2: 1, d3: 1, d4: 1,
    d5: 1, d6: 1, d7: 1, d8: 1, d9: 1,
    dot: 1, EEX: 1
};

const NEED = {
    STO: 'REG', RCL: 'REG',
    SF: 'FLAG', CF: 'FLAG', FQ: 'FLAG',
    FIX: 'DISP', SCI: 'DISP', ENG: 'DISP'
};

/* Conversion order: R.9 down to R.0, then R9 down to R0 */
const CONVERSION_ORDER = [
    19, 18, 17, 16, 15, 14, 13, 12, 11, 10,
    9, 8, 7, 6, 5, 4, 3, 2, 1, 0
];

const MAX_NUMBER = 9.999999999e99;

/* ---- build LEG.grid / KEYMAP / POS ---- */
const POS = {};
const KEYMAP = {};
const LEGgrid = [];
for (let r = 0; r < LAYOUT.length; r++) {
    const row = [];
    for (let c = 0; c < LAYOUT[r].length; c++) {
        const id = LAYOUT[r][c];
        if (id) {
            POS[id] = (r + 1) * 10 + ((c + 1) === 10 ? 0 : (c + 1));
            KEYMAP[id] = ACT[id];
        }
        row.push(id ? { id: id, P: ACT[id].P, f: ACT[id].f, g: ACT[id].g } : null);
    }
    LEGgrid.push(row);
}
POS.ENTER = 36;
KEYMAP.ENTER = ACT.ENTER;
const LEGspan = SPAN.map(function (id) {
    return { id: id, P: ACT[id].P, f: ACT[id].f, g: ACT[id].g };
});
const LEG = { grid: LEGgrid, span: LEGspan };

/* ---- numeric helpers ---- */
function round10(x) {
    if (!isFinite(x) || x === 0) return x;
    const e = Math.floor(Math.log10(Math.abs(x)));
    const f = Math.pow(10, 9 - e);
    const y = x * f;
    const r = y >= 0 ? Math.floor(y + 0.5) : Math.ceil(y - 0.5);
    return r / f;
}

/*
 * Decimal round-half-away-from-zero to `places` digits after the radix mark.
 * Works from a 15-significant-digit normalization of the scaled value so that
 * binary representation noise (e.g. 2.675*100 = 267.4999...) does not defeat
 * the half-up rule the HP-11C firmware implements in BCD.
 * Returns { sign, ip, fp, rounded } where ip/fp are digit strings.
 */
function decParts(x, places) {
    if (!isFinite(x)) return { sign: x < 0 ? "-" : "", ip: "9", fp: "", rounded: x };
    var sign = x < 0 ? "-" : "";
    var ax = Math.abs(x);
    if (places < 0) places = 0;
    if (places > 12) places = 12;
    var scale = Math.pow(10, places);
    var y = ax === 0 ? 0 : Number((ax * scale).toPrecision(15));
    var r = Math.floor(y + 0.5);
    var ip = Math.floor(r / scale);
    var fp = r - ip * scale;
    var ips = String(ip);
    var fps = places > 0 ? String(fp) : "";
    while (fps.length < places) fps = "0" + fps;
    return { sign: sign, ip: ips, fp: fps, rounded: r / scale };
}

/* Round x to `sig` significant digits, half away from zero. */
function roundSig(x, sig) {
    if (x === 0 || !isFinite(x)) return x;
    if (sig < 1) sig = 1;
    var e = Math.floor(Math.log10(Math.abs(x)));
    var scale = Math.pow(10, sig - 1 - e);
    var y = Math.abs(x) * scale;
    var r = Math.floor(Number(y.toPrecision(15)) + 0.5);
    return (x < 0 ? -1 : 1) * r / scale;
}

function applyOp(a, o, b) {
    if (o === '+') return a + b;
    if (o === '-') return a - b;
    if (o === '*') return a * b;
    return b === 0 ? NaN : a / b;
}

function okInt(v) {
    return Number.isInteger(v) && v >= 0 && v < 1e10;
}

function perm(y, x) {
    let r = 1;
    for (let i = y - x + 1; i <= y; i++) r *= i;
    return r;
}

function comb(y, x) {
    let r = 1;
    for (let i = 1; i <= x; i++) r = (r * (y - x + i)) / i;
    return r;
}

function toRad(v, mode) {
    if (mode === 'RAD') return v;
    if (mode === 'GRAD') return (v * Math.PI) / 200;
    return (v * Math.PI) / 180;
}

function fromRad(rr, mode) {
    if (mode === 'RAD') return rr;
    if (mode === 'GRAD') return (rr * 200) / Math.PI;
    return (rr * 180) / Math.PI;
}

function dec2hms(v) {
    const s = v < 0 ? -1 : 1;
    const a = Math.abs(v);
    const h = Math.floor(a);
    const mf = (a - h) * 60;
    const m = Math.floor(mf);
    return s * (h + m / 100 + ((mf - m) * 60) / 10000);
}

function hms2dec(v) {
    const s = v < 0 ? -1 : 1;
    const a = Math.abs(v);
    const h = Math.floor(a);
    const mm = a - h;
    const m = Math.floor(mm * 100 + 1e-9);
    const sec = (mm * 100 - m) * 100;
    return s * (h + m / 60 + sec / 3600);
}

function gamma(z) {
    if (z < 0.5) {
        return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    }
    z -= 1;
    const c = [
        0.99999999999980993,
        676.5203681218851,
        -1259.1392167224028,
        771.32342877765313,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.984369578019571e-6,
        1.5056327351493116e-7
    ];
    let x = c[0];
    for (let i = 0; i < 8; i++) x += c[i + 1] / (z + i + 1);
    const t = z + 7.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function regLabel(reg) {
    if (reg === 'I') return 'I';
    if (reg === 'RAN') return 'RAN';
    if (reg === 'IND') return '(i)';
    return reg < 10 ? String(reg) : '.' + (reg - 10);
}

/* ========================================================================= */
class Engine {
    constructor() {
        this.reset();
    }

    reset() {
        this.t = 0;
        this.z = 0;
        this.y = 0;
        this.x = 0;
        this.lastX = 0;
        this.I = 0;
        this.reg = [];
        for (let i = 0; i < 20; i++) this.reg[i] = 0;
        this.ranState = 0;
        this.trigMode = 'DEG';
        /* ROM power-on/reset default is FIX 4 (verified against 11c.rom) */
        this.display = { mode: 'FIX', n: 4 };
        this.radix = '.';
        this.sep = ',';
        this.prefix = null;
        this.hypPending = 0;
        this.editing = false;
        this.buf = null;
        this.error = null;
        this.liftEnabled = false;
        this.user = false;
        this.lowbat = false;
        this.running = false;
        this.mantissa = false;
        this.memHeld = false;
        this.lastKey = '';
        this.lastBuf = '';
        this.programMode = false;
        this.programMemory = [];
        this.pc = 0;
        this.retStack = [];
        this.pending = null;
        this.dispAwait = null;
        this.gtoPending = null;
        this.rec = null;
        this.pendingLBL = false;
        this.hypRec = null;
        this.off = false;
        this.flagValues = [false, false];
        this.programCapacity = 63;
        this.convertedCount = 0;
        this.previewLine = null;
        this.sstHeld = false;
        this.prError = false;
    }

    /* ---- stack ---- */
    lift() {
        this.t = this.z;
        this.z = this.y;
        this.y = this.x;
    }

    drop() {
        this.y = this.z;
        this.z = this.t;
    }

    overflowed() {
        return !isFinite(this.x) || Math.abs(this.x) > MAX_NUMBER;
    }

    setRes(v) {
        if (isFinite(v) && v !== 0 && Math.abs(v) < 1e-99) {
            this.x = 0;
            return;
        }
        v = round10(v);
        if (isFinite(v) && v !== 0 && Math.abs(v) < 1e-99) v = 0;
        this.x = v;
    }

    push(v) {
        if (this.liftEnabled) this.lift();
        this.setRes(v);
        this.liftEnabled = true;
    }

    capture() {
        this.lastBuf = this.editing && this.buf
            ? ((this.buf.neg ? '-' : '') +
                (this.buf.man || '') +
                (this.buf.inExp ? 'E' + (this.buf.expNeg ? '-' : '') + (this.buf.exp || '') : ''))
            : '';
    }

    clearTransient() {
        /* spec 2 / 4.7: transient state is cleared on power-on */
        this.prefix = null;
        this.hypPending = 0;
        this.editing = false;
        this.buf = null;
        this.pending = null;
        this.rec = null;
        this.gtoPending = null;
        this.dispAwait = null;
        this.pendingLBL = false;
        this.hypRec = null;
        this.previewLine = null;
        this.sstHeld = false;
        this.mantissa = false;
        this.memHeld = false;
        this.lastBuf = '';
    }

    /* ---- digit entry ---- */
    startEntry() {
        if (this.liftEnabled) this.lift();
        this.editing = true;
        this.buf = { neg: false, man: '', exp: '', expNeg: false, inExp: false };
        this.liftEnabled = false;
    }

    commit() {
        const b = this.buf;
        if (!b) return;
        let m = b.man;
        if (m === '' || m === '.') m = (m === '.') ? '0.' : '0';
        if (m.charAt(0) === '.') m = '0' + m;
        let v = parseFloat((b.neg ? '-' : '') + m);
        if (!isFinite(v)) v = 0;
        if (b.inExp || b.exp !== '') {
            const e = parseInt((b.expNeg ? '-' : '') + (b.exp || '0'), 10);
            v = v * Math.pow(10, e || 0);
        }
        this.x = v;
    }

    termEntry() {
        if (this.editing) {
            this.commit();
            this.editing = false;
        }
    }

    digit(n) {
        if (!this.editing) this.startEntry();
        const b = this.buf;
        if (b.inExp) {
            if (b.exp.length < 2) b.exp += n;
        } else {
            if (b.man.replace('.', '').length < 10) b.man += n;
        }
        this.commit();
    }

    dot() {
        if (!this.editing) this.startEntry();
        const b = this.buf;
        if (!b.inExp && b.man.indexOf('.') < 0) b.man += '.';
        this.commit();
    }

    eex() {
        if (!this.editing) this.startEntry();
        const b = this.buf;
        if (!b.inExp) {
            const man = b.man;
            const di = man.indexOf('.');
            const ip = di < 0 ? man : man.slice(0, di);
            const fp = di < 0 ? '' : man.slice(di + 1);
            const ipSig = ip.replace(/^0+/, '');
            const zeros = (fp.match(/^0*/) || [''])[0].length;
            const blocked = ipSig.length > 7 ||
                (ipSig.length === 0 && fp.length > 0 && zeros > 5);
            if (!blocked) {
                b.inExp = true;
                b.exp = '';
                b.expNeg = false;
            }
        }
        this.commit();
    }

    chs() {
        if (this.editing) {
            const b = this.buf;
            if (b.inExp) b.expNeg = !b.expNeg;
            else b.neg = !b.neg;
            this.commit();
        } else {
            this.x = -this.x;
            this.liftEnabled = true;
        }
    }

    back() {
        if (!this.editing) {
            this.x = 0;
            this.liftEnabled = false;
            return;
        }
        const b = this.buf;
        if (!b) {
            this.editing = false;
            this.x = 0;
            this.liftEnabled = false;
            return;
        }
        if (b.inExp) {
            if (b.exp.length > 0) {
                b.exp = b.exp.slice(0, -1);
            } else if (b.expNeg) {
                b.expNeg = false;
            } else {
                b.inExp = false;
                b.exp = '';
            }
        } else if (b.man.length > 0) {
            b.man = b.man.slice(0, -1);
            if (b.man === '') b.neg = false;
        }
        this.commit();
    }

    /* ---- effective action ---- */
    effective(id, layer) {
        /*
           spec 17.12: in Program mode, f A-E insert GSB label.
           spec 22.2: User-mode top-row exchange is a Run-mode overlay.
        */
        if (this.programMode) {
            if (TOPROW[id] && layer === 'f') return 'pgmGSB' + TOPROW[id];
            return (ACT[id] || {})[layer] || null;
        }
        let act;
        if (this.user && TOPROW[id]) {
            if (layer === 'P') act = 'run' + TOPROW[id];
            else if (layer === 'f') act = TOPMATH[id];
            else act = (ACT[id] || {})[layer] || null;
        } else {
            act = (ACT[id] || {})[layer] || null;
        }
        return act;
    }

    /* ---- keycode elements for a recorded key ---- */
    keycode(id, layer) {
        const pre = layer === 'f' ? [42] : layer === 'g' ? [43] : [];
        return pre.concat(DIGIT[id] ? [+id] : [POS[id]]);
    }

    /* ---- keyDown / keyUp ---- */
    keyDown(k, m) {
        m = m || this.prefix || 'P';
        if (this.off) {
            this.press(k, m);
            return false;
        }
        if (
            k === 'SST' &&
            m === 'P' &&
            !this.programMode &&
            this.error == null &&
            !this.running &&
            !this.gtoPending &&
            !this.rec &&
            !this.pending &&
            this.dispAwait == null
        ) {
            this.lastKey = k + '/' + m;
            this.sstHeld = true;
            this.previewLine = this.nextRunLine();
            return true;
        }
        this.press(k, m);
        return false;
    }

    keyUp(k, m) {
        if (this.off) return;
        if (k === 'SST' && this.sstHeld) {
            this.sstHeld = false;
            this.previewLine = null;
            this.runStep();
            this.capture();
        }
    }

    /* ---- key release (momentary states) ---- */
    release() {
        /* spec 4.6: MEM is displayed only while the key is held */
        if (this.memHeld) this.memHeld = false;
    }

    /* ---- main key entry ---- */
    press(k, m) {
        m = m || this.prefix || 'P';
        this.lastKey = k + '/' + m;
        this.previewLine = null;

        if (this.off) {
            if (k === 'ON') {
                this.off = false;
                this.programMode = false;
                this.running = false;
                this.error = null;
                this.clearTransient();
                this.liftEnabled = true;
            }
            return;
        }

        if (k === 'ON') {
            if (this.running) this.running = false;
            this.off = true;
            this.prefix = null;
            this.capture();
            return;
        }

        if (this.prError) {
            this.prError = false;
            this.prefix = null;
            return;
        }

        if (this.memHeld) this.memHeld = false;

        if (this.running) {
            this.running = false;
            this.prefix = null;
            return;
        }

        if (this.error != null) {
            this.error = null;
            if (k !== 'F' && k !== 'G') {
                this.prefix = null;
                return;
            }
        }

        if (k === 'F') {
            this.prefix = (this.prefix === 'f') ? null : 'f';
            return;
        }
        if (k === 'G') {
            this.prefix = (this.prefix === 'g') ? null : 'g';
            return;
        }
        this.prefix = null;

        const act = this.effective(k, m);

        if (
            !this.programMode &&
            !this.gtoPending &&
            !this.rec &&
            !this.pending &&
            this.dispAwait == null &&
            act &&
            act !== 'back' &&
            act !== 'chs' &&
            act !== 'CLRPFX' &&
            act !== 'prefF' &&
            act !== 'prefG' &&
            act !== 'on' &&
            !ENTRY[act]
        ) {
            this.termEntry();
        }

        if (this.gtoPending) {
            this.resolveGto(k, m);
            this.capture();
            return;
        }
        if (this.rec) {
            this.recOperand(k, m);
            this.capture();
            return;
        }
        if (this.pending) {
            this.runOperand(k, m);
            this.capture();
            return;
        }
        if (this.dispAwait != null) {
            const dn = (m === 'P' && DIGIT[k]) ? +k : null;
            if (dn != null) {
                this.display = {
                    mode: this.dispAwait,
                    n: (this.dispAwait === 'SCI' || this.dispAwait === 'ENG') ? Math.min(dn, 7) : dn
                };
                this.dispAwait = null;
                this.capture();
                return;
            }
            this.dispAwait = null;
        }

        /* ---------- PROGRAM MODE ---------- */
        if (this.programMode) {
            if (this.pc > this.programMemory.length) this.pc = this.programMemory.length;

            /* Combined hyperbolic instruction recording. */
            if (this.hypRec) {
                const base = TRIG_BASE[k];
                if (base && m === 'P') {
                    const inv = this.hypRec.inv;
                    this.recCommit({
                        op: (inv ? 'hypinv_' : 'hyp_') + base,
                        operand: null,
                        code: (inv ? 'HYPINV ' : 'HYP ') + base.toUpperCase(),
                        codes: this.hypRec.codes.concat(POS[k])
                    });
                    this.hypRec = null;
                    return;
                }
                this.hypRec = null;
            }

            if (act === 'PR') {
                const oldPc = this.pc;
                this.programMode = false;
                this.pc = (oldPc >= 0 && oldPc <= this.programMemory.length) ? oldPc : 0;
                this.liftEnabled = true;
                return;
            }
            if (act === 'back') {
                if (this.pc >= 1 && this.pc <= this.programMemory.length) {
                    this.programMemory.splice(this.pc - 1, 1);
                    this.pc = Math.max(0, this.pc - 1);
                }
                this.shrinkCapacityAfterDelete();
                return;
            }
            if (act === 'SST') {
                if (this.programMemory.length === 0) {
                    this.pc = 0;
                } else if (this.pc >= this.programMemory.length) {
                    this.pc = 0;
                } else {
                    this.pc = Math.min(this.programMemory.length, this.pc + 1);
                }
                return;
            }
            if (act === 'BST') {
                if (this.pc <= 0) this.pc = this.programMemory.length;
                else this.pc = Math.max(0, this.pc - 1);
                return;
            }
            if (act === 'CLRPRGM') {
                /* spec 4.5: reclaimed register blocks SHOULD be zeroed */
                for (let idx = 0; idx < this.convertedCount; idx++) {
                    this.reg[CONVERSION_ORDER[idx]] = 0;
                }
                this.programMemory = [];
                this.pc = 0;
                this.programCapacity = 63;
                this.convertedCount = 0;
                return;
            }
            if (act === 'USER') {
                this.user = !this.user;
                return;
            }
            if (act === 'MEM') {
                this.memHeld = true;
                return;
            }
            if (act === 'CLRPFX') {
                this.prefix = null;
                this.hypPending = 0;
                this.pending = null;
                this.rec = null;
                this.gtoPending = null;
                this.pendingLBL = false;
                this.dispAwait = null;
                this.hypRec = null;
                this.mantissa = false;
                return;
            }
            if (this.pendingLBL) {
                const lab = LABEL_OF[k];
                this.pendingLBL = false;
                if (lab == null) return;
                this.recCommit({
                    op: 'LBL',
                    operand: lab,
                    code: 'LBL ' + lab,
                    codes: [42, POS.SST].concat(this.keycode(k, 'P'))
                });
                return;
            }
            if (act === 'LBL') {
                this.pendingLBL = true;
                return;
            }
            if (act === 'GTO' || act === 'GSB') {
                this.gtoPending = { kind: act, dot: false, digits: '' };
                return;
            }
            if (act === 'HYP') {
                this.hypRec = { inv: false, codes: this.keycode(k, m).slice() };
                return;
            }
            if (act === 'HYPINV') {
                this.hypRec = { inv: true, codes: this.keycode(k, m).slice() };
                return;
            }

            /* Plain STO/RCL are prefixes in Program mode. */
            if (k === 'STO' && m === 'P') {
                this.rec = {
                    op: 'STO',
                    codes: this.keycode(k, m).slice(),
                    need: 'REG',
                    op2: null,
                    dot: false
                };
                return;
            }
            if (k === 'RCL' && m === 'P') {
                this.rec = {
                    op: 'RCL',
                    codes: this.keycode(k, m).slice(),
                    need: 'REG',
                    op2: null,
                    dot: false
                };
                return;
            }

            if (act === 'on') return;
            if (act == null) return;

            /* ROM: the standalone (i) and I keys are RCL (i) / RCL I
               (stored 45 24 / 45 25), not raw f-shifted keycodes. */
            if (act === 'IND') {
                this.recCommit({
                    op: 'RCL', operand: { reg: 'IND', op: null },
                    code: 'RCL (i)', codes: [45, POS.COS]
                });
                return;
            }
            if (act === 'Iop') {
                this.recCommit({
                    op: 'RCL', operand: { reg: 'I', op: null },
                    code: 'RCL I', codes: [45, POS.TAN]
                });
                return;
            }

            if (NEED[act]) {
                this.rec = {
                    op: act,
                    codes: this.keycode(k, m).slice(),
                    need: NEED[act],
                    op2: null,
                    dot: false
                };
                return;
            }

            this.recCommit({
                op: act,
                operand: null,
                code: DIGIT[k] ? k : act,
                codes: this.keycode(k, m).slice()
            });
            return;
        }

        /* ---------- RUN MODE ---------- */
        if (act === 'PR') {
            const oldPc = this.pc;
            this.programMode = true;
            this.pc = (oldPc >= 0 && oldPc <= this.programMemory.length) ? oldPc : 0;
            return;
        }
        if (act === 'GTO' || act === 'GSB') {
            this.gtoPending = { kind: act, dot: false, digits: '' };
            return;
        }
        if (act == null) return;

        if (act === 'FIX' || act === 'SCI' || act === 'ENG') {
            this.termEntry();
            this.dispAwait = act;
            this.capture();
            return;
        }
        if (NEED[act]) {
            this.pending = { kind: act, op: null, dot: false };
            this.capture();
            return;
        }

        this.runPerform(act, m, k);
        this.capture();
    }

    direct(a) {
        if (this.off) return;
        if (!ENTRY[a] && a !== 'chs' && a !== 'back') this.termEntry();
        this.runPerform(a, 'P', null);
        this.capture();
    }

    /* ---- GTO / GSB pending resolver ---- */
    resolveGto(k, m) {
        const g = this.gtoPending;
        if (!g) return;

        if (k === 'DOT' && !g.dot && g.digits === '') {
            if (g.kind === 'GTO') g.dot = true;
            else this.gtoPending = null;
            return;
        }
        if (g.dot) {
            if (DIGIT[k]) {
                g.digits += k;
                if (g.digits.length === 3) {
                    const n = +g.digits;
                    this.gtoPending = null;
                    if (n === 0 || (n >= 1 && n <= this.programMemory.length)) {
                        this.pc = n;
                    } else {
                        this.error = 4;
                    }
                }
            } else {
                this.gtoPending = null;
            }
            return;
        }
        /* ROM: indirect branch operand is the I key (f TAN, keycode 25),
           not the (i) key.  Stored as 22 25 / 32 25. */
        if (k === 'TAN') {
            this.gtoPending = null;
            if (this.programMode) {
                this.recCommit({
                    op: g.kind,
                    operand: { kind: 'ind' },
                    code: g.kind + ' I',
                    codes: [POS[g.kind === 'GTO' ? 'GTO' : 'GSB'], POS.TAN]
                });
            } else {
                if (this.doBranch(g.kind, { kind: 'ind' })) {
                    if (g.kind === 'GSB') {
                        this.liftEnabled = true;
                        this.runProgram();
                    }
                }
            }
            return;
        }
        if (LABEL_OF[k] != null) {
            const name = LABEL_OF[k];
            this.gtoPending = null;
            if (this.programMode) {
                this.recCommit({
                    op: g.kind,
                    operand: { kind: 'label', name: name },
                    code: g.kind + ' ' + name,
                    codes: [POS[g.kind === 'GTO' ? 'GTO' : 'GSB']].concat(this.keycode(k, 'P'))
                });
            } else {
                if (this.doBranch(g.kind, { kind: 'label', name: name })) {
                    if (g.kind === 'GSB') {
                        this.liftEnabled = true;
                        this.runProgram();
                    }
                }
            }
            return;
        }
        this.gtoPending = null;
    }

    /* ---- recorded-operand resolver (program mode) ---- */
    recOperand(k, m) {
        const rc = this.rec;
        const act = rc.op;

        if (act === 'STO' && rc.op2 === null && Object.prototype.hasOwnProperty.call(ARITH, k)) {
            if (m !== 'P') {
                this.rec = null;
                return;
            }
            rc.op2 = ARITH[k];
            rc.codes.push(POS[k]);
            return;
        }

        if (rc.need === 'FLAG') {
            if (!DIGIT[k]) {
                this.rec = null;
                return;
            }
            const f = +k;
            if (f > 1) {
                this.rec = null;
                this.error = 6;
                return;
            }
            rc.codes.push(f);
            this.recCommit({
                op: act,
                operand: f,
                code: act + ' ' + f,
                codes: rc.codes
            });
            return;
        }

        if (rc.need === 'DISP') {
            if (!DIGIT[k]) {
                this.rec = null;
                return;
            }
            const dn = +k;
            const stored = (act === 'SCI' || act === 'ENG') ? Math.min(dn, 7) : dn;
            rc.codes.push(stored);
            this.recCommit({
                op: act,
                operand: stored,
                code: act + ' ' + dn,
                codes: rc.codes
            });
            return;
        }

        if (rc.need === 'REG') {
            /* spec 15.9: RCL Sigma+ is programmable, keycode 45 49 */
            if (rc.op === 'RCL' && k === 'SIGMA') {
                rc.codes.push(POS.SIGMA);
                this.recCommit({
                    op: 'RCLSIGMA',
                    operand: null,
                    code: 'RCL SIGMA',
                    codes: rc.codes
                });
                return;
            }
            if (k === 'DOT') {
                rc.dot = true;
                rc.codes.push(48);
                return;
            }
            let reg = null;
            let push = null;
            if (k === 'TAN') {
                reg = 'I';
                push = POS.TAN;
            } else if (k === 'COS') {
                reg = 'IND';
                push = POS.COS;
            } else if (k === 'ENTER') {
                reg = 'RAN';
                push = POS.ENTER;
            } else if (DIGIT[k]) {
                reg = rc.dot ? (10 + (+k)) : (+k);
                push = +k;
            }
            if (reg === null) {
                this.rec = null;
                return;
            }
            if (rc.op2) {
                const directNumeric = (typeof reg === 'number' && reg >= 0 && reg <= 9);
                if (!directNumeric && reg !== 'IND') {
                    this.rec = null;
                    return;
                }
            }
            rc.codes.push(push);
            const sym = rc.op2 ? (' ' + rc.op2) : '';
            this.recCommit({
                op: act,
                operand: { reg: reg, op: rc.op2 },
                code: act + sym + ' ' + regLabel(reg),
                codes: rc.codes
            });
            return;
        }

        this.rec = null;
    }

    /* ---- run-mode operand resolver ---- */
    runOperand(k, m) {
        const p = this.pending;

        if (p.kind === 'STO' && p.op === null && Object.prototype.hasOwnProperty.call(ARITH, k)) {
            if (m !== 'P') {
                this.pending = null;
                return;
            }
            p.op = ARITH[k];
            return;
        }

        if (p.kind === 'SF' || p.kind === 'CF' || p.kind === 'FQ') {
            if (!DIGIT[k]) {
                this.pending = null;
                return;
            }
            const f = +k;
            if (f > 1) {
                this.pending = null;
                this.error = 6;
                return;
            }
            this.doFlag(p.kind, f);
            this.pending = null;
            return;
        }

        if (p.kind === 'STO' || p.kind === 'RCL') {
            /* spec 15.9: RCL Sigma+ recalls R1->X and R3->Y */
            if (p.kind === 'RCL' && k === 'SIGMA') {
                this.rclSigma();
                this.pending = null;
                return;
            }
            if (k === 'DOT') {
                p.dot = true;
                return;
            }
            let reg = null;
            if (k === 'TAN') reg = 'I';
            else if (k === 'COS') reg = 'IND';
            else if (k === 'ENTER') reg = 'RAN';
            else if (DIGIT[k]) reg = p.dot ? (10 + (+k)) : (+k);
            if (reg === null) {
                this.pending = null;
                return;
            }
            if (p.kind === 'STO' && p.op) {
                const directNumeric = (typeof reg === 'number' && reg >= 0 && reg <= 9);
                if (!directNumeric && reg !== 'IND') {
                    this.pending = null;
                    return;
                }
            }
            this.doReg(p.kind, reg, p.op);
            this.pending = null;
            return;
        }

        this.pending = null;
    }

    /* ---- program memory capacity ---- */
    ensureProgramCapacity() {
        if (this.programMemory.length < this.programCapacity) return true;
        if (this.programCapacity >= 203) return false;
        this.programCapacity = Math.min(203, this.programCapacity + 7);
        this.convertedCount++;
        return true;
    }

    shrinkCapacityAfterDelete() {
        while (this.convertedCount > 0) {
            const previousCapacity = 63 + 7 * (this.convertedCount - 1);
            if (this.programMemory.length <= previousCapacity) {
                this.programCapacity = previousCapacity;
                this.convertedCount--;
            } else {
                break;
            }
        }
    }

    recCommit(instr) {
        this.rec = null;
        if (instr && typeof instr.op === 'string' && instr.op.indexOf('pgmGSB') === 0) {
            const lab = instr.op.charAt(instr.op.length - 1);
            const keyId = LABEL_KEY[lab] || 'SQRT';
            instr = {
                op: 'GSB',
                operand: { kind: 'label', name: lab },
                code: 'GSB ' + lab,
                codes: [POS.GSB, POS[keyId]]
            };
        }
        if (this.programMemory.length >= this.programCapacity) {
            if (!this.ensureProgramCapacity()) {
                this.error = 4;
                return;
            }
        }
        if (this.programMode && this.pc >= 0 && this.pc < this.programMemory.length) {
            this.programMemory.splice(this.pc, 0, instr);
            this.pc += 1;
        } else {
            this.programMemory.push(instr);
            this.pc = this.programMemory.length;
        }
    }

    /* ---- run-mode immediate perform ---- */
    runPerform(act, m, k) {
        const s = this;
        switch (act) {
            case 'prefF':
            case 'prefG':
                return;
            case 'FIX':
            case 'SCI':
            case 'ENG':
                s.dispAwait = act;
                return;
            case 'DEG':
            case 'RAD':
            case 'GRAD':
                s.trigMode = act;
                return;
            case 'HYP':
                s.hypPending = 1;
                return;
            case 'HYPINV':
                s.hypPending = 2;
                return;
            case 'USER':
                s.user = !s.user;
                return;
            case 'MEM':
                s.memHeld = true;
                return;
            case 'CLRPFX':
                s.prefix = null;
                s.hypPending = 0;
                s.pending = null;
                s.gtoPending = null;
                s.dispAwait = null;
                s.mantissa = true;
                return;
            case 'CLRPRGM':
                /* spec 4.5: Run-mode CLEAR PRGM sets PC=000 only */
                s.pc = 0;
                return;
            case 'CLRREG':
                for (let i = 0; i < 20; i++) s.reg[i] = 0;
                s.I = 0;
                return;
            case 'CLRSIGMA':
                if (!s.statsAvailable()) {
                    s.error = 3;
                    return;
                }
                for (let j = 0; j < 6; j++) s.reg[j] = 0;
                s.t = 0;
                s.z = 0;
                s.y = 0;
                s.x = 0;
                s.liftEnabled = false;
                s.editing = false;
                return;
            case 'on':
                return;
            case 'sto':
                s.pending = { kind: 'STO', op: null, dot: false };
                return;
            case 'rcl':
                s.pending = { kind: 'RCL', op: null, dot: false };
                return;
            case 'SF':
            case 'CF':
            case 'FQ':
                s.pending = { kind: act, op: null };
                return;
            case 'dot':
                s.dot();
                return;
            case 'EEX':
                s.eex();
                return;
            case 'back':
                s.back();
                return;
            case 'chs':
                s.chs();
                return;
            case 'enter':
                s.lift();
                s.liftEnabled = false;
                s.editing = false;
                return;
            case 'clx':
                s.x = 0;
                s.liftEnabled = false;
                s.editing = false;
                return;
            case 'SST':
                s.runStep();
                return;
            case 'BST': {
                const n = s.programMemory.length;
                if (n === 0) {
                    s.pc = 0;
                } else if (s.pc <= 0) {
                    s.pc = n;
                } else {
                    s.pc = s.pc - 1;
                }
                if (n > 0) s.previewLine = s.pc;
                return;
            }
            case 'RS': {
                const len = s.programMemory.length;
                if (len === 0) return;
                if (s.pc === 0) s.pc = 1;
                if (s.pc < 1 || s.pc > len) {
                    s.error = 4;
                    return;
                }
                s.runProgram();
                return;
            }
            case 'lstx':
                if (s.liftEnabled) s.lift();
                s.x = s.lastX;
                s.liftEnabled = true;
                return;
            case 'swap': {
                const t = s.x;
                s.x = s.y;
                s.y = t;
                s.liftEnabled = true;
                return;
            }
            case 'rdn': {
                const a = s.x;
                s.x = s.y;
                s.y = s.z;
                s.z = s.t;
                s.t = a;
                s.liftEnabled = true;
                return;
            }
            case 'rup': {
                const b = s.x;
                s.x = s.t;
                s.t = s.z;
                s.z = s.y;
                s.y = b;
                s.liftEnabled = true;
                return;
            }
            case 'XSWAPI': {
                const cc = s.x;
                s.x = s.I;
                s.I = cc;
                s.liftEnabled = true;
                return;
            }
            case 'XEXI':
                s.exchangeIndirect();
                return;
            case 'Iop':
                s.regPush('I');
                return;
            case 'IND':
                s.regPush('IND');
                return;
            case 'RAN':
                s.random();
                return;
            case 'pi':
                s.push(round10(Math.PI));
                return;
            case 'runA':
            case 'runB':
            case 'runC':
            case 'runD':
            case 'runE':
                s.runLabel(act.charAt(3));
                return;
            case 'LBL':
                return;
            case 'PSE':
                return;
            case 'RTN':
                s.pc = 0;
                return;
            case 'cLE':
            case 'cGT':
            case 'cNE':
            case 'cEQ':
            case 'cL0':
            case 'cG0':
            case 'cN0':
            case 'cE0':
                return;
            case 'ISG':
                s.isg(false);
                return;
            case 'DSE':
                s.isg(true);
                return;
            default:
                if (act && /^d\d$/.test(act)) {
                    s.digit(+act.charAt(1));
                    return;
                }
                s.mathAct(act);
                return;
        }
    }

    /* ---- register addressing and availability ---- */
    indirectAddress() {
        return Math.abs(Math.trunc(this.I));
    }

    registerAvailable(reg) {
        let n;
        if (reg === 'I' || reg === 'RAN') return true;
        if (reg === 'IND') {
            n = this.indirectAddress();
            if (n === 20) return true;
            if (n > 20) return false;
        } else {
            n = reg;
        }
        if (!Number.isInteger(n) || n < 0 || n > 19) return false;
        const idx = CONVERSION_ORDER.indexOf(n);
        return idx === -1 || idx >= this.convertedCount;
    }

    statsAvailable() {
        for (let i = 0; i <= 5; i++) {
            if (!this.registerAvailable(i)) return false;
        }
        return true;
    }

    regGet(reg) {
        if (reg === 'I') return this.I;
        if (reg === 'RAN') {
            return this.ranState / 2147483647;
        }
        if (reg === 'IND') {
            const n = this.indirectAddress();
            if (n === 20) return this.I;
            if (n > 20) return 0;
            return this.reg[n];
        }
        return this.reg[reg];
    }

    regSet(reg, v) {
        if (reg === 'I') {
            this.I = v;
            return;
        }
        if (reg === 'RAN') {
            this.setSeed(v);
            return;
        }
        if (reg === 'IND') {
            const n = this.indirectAddress();
            if (n === 20) this.I = v;
            else if (n <= 20) this.reg[n] = v;
            return;
        }
        this.reg[reg] = v;
    }

    setSeed(v) {
        let vv = Math.abs(v);
        /*
           spec 14.3:
           If seed magnitude >= 1, shift the decimal point left of the
           first significant digit before scaling.
        */
        if (vv !== 0 && isFinite(vv) && vv >= 1) {
            vv = vv / Math.pow(10, Math.floor(Math.log10(vv)) + 1);
        }
        let q = Math.round(vv * 2147483646);
        if (!isFinite(q)) q = 0;
        if (q < 0) q = 0;
        if (q > 2147483646) q = 2147483646;
        this.ranState = q;
    }

    regPush(reg) {
        if (!this.registerAvailable(reg)) {
            this.error = 3;
            return;
        }
        const v = this.regGet(reg);
        if (this.liftEnabled) this.lift();
        this.x = v;
        this.liftEnabled = true;
        this.editing = false;
    }

    exchangeIndirect() {
        const n = this.indirectAddress();
        if (n > 20) {
            this.error = 3;
            return;
        }
        if (n < 20 && !this.registerAvailable(n)) {
            this.error = 3;
            return;
        }
        const old = this.x;
        if (n === 20) {
            this.x = this.I;
            this.I = old;
        } else {
            this.x = this.reg[n];
            this.reg[n] = old;
        }
        this.liftEnabled = true;
    }

    doReg(kind, reg, op) {
        if (!this.registerAvailable(reg)) {
            this.error = 3;
            return;
        }
        if (kind === 'RCL') {
            const v = this.regGet(reg);
            if (this.liftEnabled) this.lift();
            this.x = v;
            this.liftEnabled = true;
            this.editing = false;
            return;
        }
        if (!op) {
            this.regSet(reg, this.x);
            return;
        }
        /* ROM: address 20 is I for arithmetic too (verified) */
        if (reg === 'I' || reg === 'RAN') {
            this.error = 3;
            return;
        }
        if (typeof reg === 'number' && reg > 9) {
            this.error = 3;
            return;
        }
        if (op === '/' && this.x === 0) {
            this.error = 0;
            return;
        }
        const rr = applyOp(this.regGet(reg), op, this.x);
        if (!isFinite(rr) || Math.abs(rr) > MAX_NUMBER) {
            this.error = 1;
        } else {
            this.regSet(reg, round10(rr));
        }
    }

    /* spec 15.9: RCL Sigma+ — recall R1 into X and R3 into Y.
       Stack lifts as if two numbers had been keyed in sequence:
       T <- old Y, Z <- old X. Does not update LAST X. Error 3 if any
       of R0..R5 is converted to program memory. */
    rclSigma() {
        if (!this.statsAvailable()) {
            this.error = 3;
            return;
        }
        const rx = this.reg[1];
        const ry = this.reg[3];
        if (this.liftEnabled) {
            this.t = this.y;
            this.z = this.x;
        }
        this.x = rx;
        this.y = ry;
        this.liftEnabled = true;
        this.editing = false;
    }

    doFlag(op, f) {
        if (op === 'SF') this.flagsSet(f, true);
        else if (op === 'CF') this.flagsSet(f, false);
    }

    flagsSet(f, v) {
        if (!this.flagValues) this.flagValues = [false, false];
        this.flagValues[f] = v;
    }

    flagGet(f) {
        return this.flagValues ? !!this.flagValues[f] : false;
    }

    /* ---- ISG / DSE ---- */
    parseCtrl() {
        const v = round10(this.I);
        if (v === 0) return { cnt: 0, xxx: 0, yy: 1, sign: 1 };
        const sign = v < 0 ? -1 : 1;
        const a = Math.abs(v);
        const exp10 = Math.floor(Math.log10(a));
        const mant = Math.round(a / Math.pow(10, exp10 - 9));
        let ds = String(mant);
        while (ds.length < 10) ds = '0' + ds;
        if (ds.length > 10) ds = ds.slice(0, 10);
        const intCount = exp10 + 1;
        let intStr;
        let fracStr;
        if (intCount >= 10) {
            intStr = ds;
            for (let z = 0; z < intCount - 10; z++) intStr += '0';
            fracStr = '';
        } else if (intCount <= 0) {
            intStr = '0';
            fracStr = '';
            for (let z2 = 0; z2 < -intCount; z2++) fracStr += '0';
            fracStr += ds;
        } else {
            intStr = ds.slice(0, intCount);
            fracStr = ds.slice(intCount);
        }
        const cnt = parseInt(intStr, 10) || 0;
        const xxx = parseInt((fracStr + '000').slice(0, 3), 10) || 0;
        let yy = fracStr.length >= 4
            ? parseInt(fracStr.charAt(3) + (fracStr.charAt(4) || '0'), 10)
            : 1;
        if (yy === 0) yy = 1;
        return { cnt: sign * cnt, xxx: xxx, yy: yy, sign: sign };
    }

    isg(dec) {
        const p = this.parseCtrl();
        const nc = p.cnt + (dec ? -p.yy : p.yy);
        const nv = p.sign < 0
            ? -(Math.abs(nc) + p.xxx / 1000 + p.yy / 100000)
            : (Math.abs(nc) + p.xxx / 1000 + p.yy / 100000);
        this.I = round10(nv);
        return dec ? (nc <= p.xxx) : (nc > p.xxx);
    }

    /* ---- conditionals ---- */
    cond(op) {
        const x = this.x;
        const y = this.y;
        switch (op) {
            case 'cLE': return x <= y;
            case 'cGT': return x > y;
            case 'cNE': return x !== y;
            case 'cEQ': return x === y;
            case 'cL0': return x < 0;
            case 'cG0': return x > 0;
            case 'cN0': return x !== 0;
            case 'cE0': return x === 0;
        }
        return false;
    }

    /* ---- math ---- */
    unary(bad, fn) {
        if (bad(this.x)) {
            this.error = 0;
            return;
        }
        const o = this.x;
        this.setRes(fn(this.x));
        this.lastX = o;
        this.liftEnabled = true;
    }

    binary(bad, fn) {
        const a = this.y;
        const b = this.x;
        if (bad(a, b)) {
            this.error = 0;
            return;
        }
        this.lastX = b;
        const rr = fn(a, b);
        this.drop();
        this.setRes(rr);
        this.liftEnabled = true;
    }

    mathAct(act) {
        const s = this;
        switch (act) {
            case 'sqrt':
                s.unary(function (x) { return x < 0; }, Math.sqrt);
                return;
            case 'sq':
                s.unary(function () { return false; }, function (x) { return x * x; });
                return;
            case 'inv':
                s.unary(function (x) { return x === 0; }, function (x) { return 1 / x; });
                return;
            case 'exp':
                s.unary(function () { return false; }, Math.exp);
                return;
            case 'ln':
                s.unary(function (x) { return x <= 0; }, Math.log);
                return;
            case 'tenx':
                s.unary(function () { return false; }, function (x) { return Math.pow(10, x); });
                return;
            case 'log':
                s.unary(function (x) { return x <= 0; }, Math.log10);
                return;
            case 'abs':
                s.unary(function () { return false; }, Math.abs);
                return;
            case 'int':
                s.unary(function () { return false; }, Math.trunc);
                return;
            case 'frac':
                s.unary(function () { return false; }, function (x) { return x - Math.trunc(x); });
                return;
            case 'rnd':
                s.unary(function () { return false; }, function (x) { return s.rnd(x); });
                return;
            case 'fact': {
                const xv = s.x;
                s.lastX = xv;
                if (xv < 0) {
                    s.x = -MAX_NUMBER;
                } else if (Number.isInteger(xv) && xv >= 70) {
                    s.x = MAX_NUMBER;
                } else {
                    s.setRes(gamma(xv + 1));
                }
                s.liftEnabled = true;
                return;
            }
            case 'HMS':
                s.unary(function () { return false; }, dec2hms);
                return;
            case 'TOH':
                s.unary(function () { return false; }, hms2dec);
                return;
            case 'TORAD':
                s.unary(function () { return false; }, function (x) { return x * Math.PI / 180; });
                return;
            case 'TODEG':
                s.unary(function () { return false; }, function (x) { return x * 180 / Math.PI; });
                return;
            case 'sin':
            case 'cos':
            case 'tan':
            case 'asin':
            case 'acos':
            case 'atan':
                s.trig(act);
                return;
            case 'hyp_sin':
            case 'hyp_cos':
            case 'hyp_tan':
            case 'hypinv_sin':
            case 'hypinv_cos':
            case 'hypinv_tan': {
                const base = act.slice(act.indexOf('_') + 1);
                s.hypPending = act.indexOf('hypinv_') === 0 ? 2 : 1;
                s.trig(base);
                return;
            }
            case 'add':
                s.binary(function () { return false; }, function (a, b) { return a + b; });
                return;
            case 'sub':
                s.binary(function () { return false; }, function (a, b) { return a - b; });
                return;
            case 'mul':
                s.binary(function () { return false; }, function (a, b) { return a * b; });
                return;
            case 'div':
                s.binary(function (a, b) { return b === 0; }, function (a, b) { return a / b; });
                return;
            case 'yx':
                s.binary(
                    function (a, b) {
                        return (a === 0 && b <= 0) || (a < 0 && !Number.isInteger(b));
                    },
                    function (a, b) { return Math.pow(a, b); }
                );
                return;
            case 'PYX':
                s.binary(
                    function (a, b) { return !(okInt(a) && okInt(b) && b <= a); },
                    function (a, b) { return perm(a, b); }
                );
                s.flash();
                return;
            case 'CYX':
                s.binary(
                    function (a, b) { return !(okInt(a) && okInt(b) && b <= a); },
                    function (a, b) { return comb(a, b); }
                );
                s.flash();
                return;
            case 'pct': {
                const y = s.y;
                const x = s.x;
                s.lastX = x;
                s.setRes(y * x / 100);
                s.liftEnabled = true;
                return;
            }
            case 'deltapct': {
                const yb = s.y;
                const xb = s.x;
                if (yb === 0) {
                    s.error = 0;
                    return;
                }
                s.lastX = xb;
                s.setRes(((xb - yb) / yb) * 100);
                s.liftEnabled = true;
                return;
            }
            case 'TOP': {
                const x3 = s.x;
                const y3 = s.y;
                const rr = Math.hypot(x3, y3);
                const th = fromRad(Math.atan2(y3, x3), s.trigMode);
                s.lastX = x3;
                s.drop();
                s.setRes(rr);
                s.y = round10(th);
                s.liftEnabled = true;
                return;
            }
            case 'TOR': {
                const r2 = s.x;
                const th2 = s.y;
                const tr = toRad(th2, s.trigMode);
                const xr = r2 * Math.cos(tr);
                const yr = r2 * Math.sin(tr);
                s.lastX = r2;
                s.drop();
                s.setRes(xr);
                s.y = round10(yr);
                s.liftEnabled = true;
                return;
            }
            case 'sigma': {
                if (!s.statsAvailable()) {
                    s.error = 3;
                    return;
                }
                const xs = s.x;
                const ys = s.y;
                s.lastX = xs;
                /* spec 15.3: Sigma+ never raises Error 1 on overflow */
                const n = round10(s.reg[0] + 1);
                s.reg[0] = n;
                s.reg[1] = round10(s.reg[1] + xs);
                s.reg[2] = round10(s.reg[2] + xs * xs);
                s.reg[3] = round10(s.reg[3] + ys);
                s.reg[4] = round10(s.reg[4] + ys * ys);
                s.reg[5] = round10(s.reg[5] + xs * ys);
                s.x = n;
                s.liftEnabled = false;
                return;
            }
            case 'sigmam': {
                if (!s.statsAvailable()) {
                    s.error = 3;
                    return;
                }
                const xs2 = s.x;
                const ys2 = s.y;
                s.lastX = xs2;
                /* spec 15.3: Sigma- never raises Error 1 on overflow */
                const n2 = round10(s.reg[0] - 1);
                s.reg[0] = n2;
                s.reg[1] = round10(s.reg[1] - xs2);
                s.reg[2] = round10(s.reg[2] - xs2 * xs2);
                s.reg[3] = round10(s.reg[3] - ys2);
                s.reg[4] = round10(s.reg[4] - ys2 * ys2);
                s.reg[5] = round10(s.reg[5] - xs2 * ys2);
                s.x = n2;
                s.liftEnabled = false;
                return;
            }
            case 'MEAN': {
                if (!s.statsAvailable()) {
                    s.error = 3;
                    return;
                }
                const n3 = s.reg[0];
                if (n3 === 0) {
                    s.error = 2;
                    return;
                }
                const mx = s.reg[1] / n3;
                const my = s.reg[3] / n3;
                if (!isFinite(mx) || !isFinite(my)) {
                    s.error = 2;
                    return;
                }
                /* spec 15.4: lifts in the same manner as RCL Sigma+
                   (T <- old Y, Z <- old X); does not update LAST X */
                if (s.liftEnabled) {
                    s.t = s.y;
                    s.z = s.x;
                }
                s.x = round10(mx);
                s.y = round10(my);
                s.liftEnabled = true;
                return;
            }
            case 's': {
                if (!s.statsAvailable()) {
                    s.error = 3;
                    return;
                }
                const n4 = s.reg[0];
                if (n4 <= 1) {
                    s.error = 2;
                    return;
                }
                const vx = (n4 * s.reg[2] - Math.pow(s.reg[1], 2)) / (n4 * (n4 - 1));
                const vy = (n4 * s.reg[4] - Math.pow(s.reg[3], 2)) / (n4 * (n4 - 1));
                if (!isFinite(vx) || vx < 0 || !isFinite(vy) || vy < 0) {
                    s.error = 2;
                    return;
                }
                const sx = Math.sqrt(vx);
                const sy = Math.sqrt(vy);
                if (!isFinite(sx) || !isFinite(sy)) {
                    s.error = 2;
                    return;
                }
                /* spec 15.5: lifts in the same manner as RCL Sigma+;
                   does not update LAST X */
                if (s.liftEnabled) {
                    s.t = s.y;
                    s.z = s.x;
                }
                s.x = round10(sx);
                s.y = round10(sy);
                s.liftEnabled = true;
                return;
            }
            case 'LR': {
                if (!s.statsAvailable()) {
                    s.error = 3;
                    return;
                }
                const n5 = s.reg[0];
                const D = n5 * s.reg[2] - Math.pow(s.reg[1], 2);
                if (n5 <= 1 || D === 0) {
                    s.error = 2;
                    return;
                }
                const A = (n5 * s.reg[5] - s.reg[1] * s.reg[3]) / D;
                const B = (s.reg[3] * s.reg[2] - s.reg[1] * s.reg[5]) / D;
                if (!isFinite(A) || !isFinite(B)) {
                    s.error = 2;
                    return;
                }
                /* spec 15.7: lifts in the same manner as RCL Sigma+;
                   does not update LAST X */
                if (s.liftEnabled) {
                    s.t = s.y;
                    s.z = s.x;
                }
                s.x = round10(B);
                s.y = round10(A);
                s.liftEnabled = true;
                return;
            }
            case 'YR': {
                if (!s.statsAvailable()) {
                    s.error = 3;
                    return;
                }
                const n6 = s.reg[0];
                const D2 = n6 * s.reg[2] - Math.pow(s.reg[1], 2);
                const M = n6 * s.reg[4] - Math.pow(s.reg[3], 2);
                if (n6 <= 1 || D2 === 0 || M === 0) {
                    s.error = 2;
                    return;
                }
                const denom = D2 * M;
                if (!isFinite(denom) || denom < 0) {
                    s.error = 2;
                    return;
                }
                const sqrtDenom = Math.sqrt(denom);
                if (!isFinite(sqrtDenom)) {
                    s.error = 2;
                    return;
                }
                const A2 = (n6 * s.reg[5] - s.reg[1] * s.reg[3]) / D2;
                const B2 = (s.reg[3] * s.reg[2] - s.reg[1] * s.reg[5]) / D2;
                const rr2 = (n6 * s.reg[5] - s.reg[1] * s.reg[3]) / sqrtDenom;
                if (!isFinite(A2) || !isFinite(B2) || !isFinite(rr2)) {
                    s.error = 2;
                    return;
                }
                const x0 = s.x;
                s.lastX = x0;
                /* spec 15.8: y,r lifts once and saves LAST X */
                if (s.liftEnabled) s.lift();
                s.x = round10(A2 * x0 + B2);
                s.y = round10(rr2);
                s.liftEnabled = true;
                return;
            }
        }
    }

    trig(act) {
        const inv = act.charAt(0) === 'a';
        const base = inv ? act.slice(1) : act;
        const h = this.hypPending;
        this.hypPending = 0;
        const x = this.x;
        const effInvHyp = (h === 2 && !inv) || (h === 1 && inv);

        if (h === 0 && inv && (x < -1 || x > 1)) {
            this.error = 0;
            return;
        }
        if (effInvHyp && base === 'cos' && x < 1) {
            this.error = 0;
            return;
        }
        if (effInvHyp && base === 'tan' && Math.abs(x) > 1) {
            this.error = 0;
            return;
        }
        /* spec 10.3: atanh(+/-1) returns the largest finite value exactly */
        if (effInvHyp && base === 'tan' && (x === 1 || x === -1)) {
            this.lastX = this.x;
            this.x = (x === 1) ? MAX_NUMBER : -MAX_NUMBER;
            this.liftEnabled = true;
            return;
        }

        const F = { sin: Math.sin, cos: Math.cos, tan: Math.tan };
        const INV = { sin: Math.asin, cos: Math.acos, tan: Math.atan };
        const HF = { sin: Math.sinh, cos: Math.cosh, tan: Math.tanh };
        const HI = { sin: Math.asinh, cos: Math.acosh, tan: Math.atanh };
        const fn = h === 0
            ? (inv ? INV[base] : F[base])
            : h === 1
                ? (inv ? HI[base] : HF[base])
                : (inv ? HF[base] : HI[base]);
        const rr = h === 0
            ? (inv ? fromRad(fn(x), this.trigMode) : fn(toRad(x, this.trigMode)))
            : fn(x);
        this.lastX = this.x;
        this.setRes(rr);
        this.liftEnabled = true;
    }

    flash() {
        const s = this;
        if (!s.running) {
            s.running = true;
            setTimeout(function () {
                s.running = false;
            }, 350);
        }
    }

    nextRan() {
        if (!this.ranState) this.ranState = 1;
        this.ranState = (this.ranState * 16807) % 2147483647;
        return this.ranState / 2147483647;
    }

    random() {
        const r = this.nextRan();
        if (this.liftEnabled) this.lift();
        this.x = r;
        this.liftEnabled = true;
        this.editing = false;
    }

    rnd(x) {
        const m = this.display.mode;
        const n = this.display.n;
        if (m === 'FIX') {
            const dp = decParts(Math.abs(x), n);
            return (x < 0 ? -1 : 1) * dp.rounded;
        }
        /* SCI/ENG: n digits after the leading digit -> n+1 significant digits */
        return roundSig(x, n + 1);
    }

    /* ---- program execution ---- */
    findLabel(name, from) {
        const len = this.programMemory.length;
        const start = (from >= 1 && from <= len) ? from - 1 : 0;
        let i;
        let ins;
        for (i = start; i < len; i++) {
            ins = this.programMemory[i];
            if (ins && ins.op === 'LBL' && ins.operand === name) return i + 1;
        }
        for (i = 0; i < start; i++) {
            ins = this.programMemory[i];
            if (ins && ins.op === 'LBL' && ins.operand === name) return i + 1;
        }
        return -1;
    }

    indLabel(n) {
        if (n < 0 || n > 14) return null;
        return n < 10 ? String(n) : String.fromCharCode(65 + (n - 10));
    }

    resolveTarget(od, from) {
        if (!od) return -1;
        if (od.kind === 'line') {
            const n = od.n;
            if (n === 0) return 0;
            if (n >= 1 && n <= this.programMemory.length) return n;
            return -1;
        }
        if (od.kind === 'label') {
            return this.findLabel(od.name, from);
        }
        const neg = this.I < 0;
        const i = Math.abs(Math.trunc(this.I));
        if (neg) {
            if (i === 0) return -1;
            if (i >= 1 && i <= this.programMemory.length) return i;
            return -1;
        }
        /* ROM: addresses 15..19 are ordinary "label not found" -> Error 4 */
        const lab = this.indLabel(i);
        if (lab == null) return -1;
        return this.findLabel(lab, from);
    }

    doBranch(kind, od) {
        const d = this.resolveTarget(od, this.pc);
        if (d === -2) return false;
        if (d < 0) {
            this.error = 4;
            return false;
        }
        if (kind === 'GSB') {
            if (this.retStack.length >= 4) {
                this.error = 5;
                return false;
            }
            this.retStack.push(this.pc + 1);
        }
        this.pc = d;
        return true;
    }

    runLabel(ch) {
        const line = this.findLabel(ch, this.pc);
        if (line < 0) {
            this.error = 4;
            return;
        }
        this.termEntry();
        this.liftEnabled = true;
        this.pc = line;
        this.runProgram();
    }

    runProgram() {
        if (this.running) return;
        const len = this.programMemory.length;
        if (len === 0) return;
        if (this.pc === 0) this.pc = 1;
        if (this.pc < 1 || this.pc > len) {
            this.error = 4;
            return;
        }
        this.running = true;
        this.runChunk();
    }

    runChunk() {
        const s = this;
        let budget = 200;
        while (s.running && budget > 0) {
            budget--;
            if (s.pc < 1 || s.pc > s.programMemory.length) {
                s.running = false;
                s.pc = 0;
                return;
            }
            const dir = s.execLine(s.pc - 1);
            if (dir === 'halt') {
                s.running = false;
                if (s.pc < 1 || s.pc > s.programMemory.length) s.pc = 0;
                return;
            }
            if (dir === 'pause') {
                s.pc++;
                setTimeout(function () {
                    s.runChunk();
                }, 1000);
                return;
            }
            if (dir === 'branch') {
                /* pc already set */
            } else if (dir === 'skip') {
                s.pc += 2;
            } else {
                s.pc += 1;
            }
            if (s.pc < 1 || s.pc > s.programMemory.length) {
                s.running = false;
                s.pc = 0;
                return;
            }
        }
        if (s.running) {
            setTimeout(function () {
                s.runChunk();
            }, 0);
        }
    }

    execLine(L) {
        const ins = this.programMemory[L];
        if (!ins) return 'halt';
        if (!ENTRY[ins.op] && ins.op !== 'chs' && ins.op !== 'back') {
            this.termEntry();
        }
        return this.execInstr(ins);
    }

    execInstr(ins) {
        const s = this;
        const op = ins.op;
        const od = ins.operand;

        if (op === 'LBL') return 'continue';
        if (op === 'RS') {
            s.pc++;
            return 'halt';
        }
        if (op === 'PSE') return 'pause';
        if (op === 'RTN') {
            if (s.retStack.length) {
                s.pc = s.retStack.pop();
                return 'branch';
            }
            s.pc = 0;
            return 'halt';
        }
        if (op === 'GTO') {
            const d = s.resolveTarget(od, s.pc);
            if (d === -2) return 'continue';
            if (d < 0) {
                s.error = 4;
                return 'halt';
            }
            s.pc = d;
            return 'branch';
        }
        if (op === 'GSB') {
            const d2 = s.resolveTarget(od, s.pc);
            if (d2 === -2) return 'continue';
            if (d2 < 0) {
                s.error = 4;
                return 'halt';
            }
            if (s.retStack.length >= 4) {
                s.error = 5;
                return 'halt';
            }
            s.retStack.push(s.pc + 1);
            s.pc = d2;
            return 'branch';
        }
        if (
            op === 'cLE' || op === 'cGT' || op === 'cNE' || op === 'cEQ' ||
            op === 'cL0' || op === 'cG0' || op === 'cN0' || op === 'cE0'
        ) {
            return s.cond(op) ? 'continue' : 'skip';
        }
        if (op === 'SF') {
            s.flagsSet(od, true);
            return 'continue';
        }
        if (op === 'CF') {
            s.flagsSet(od, false);
            return 'continue';
        }
        if (op === 'FQ') {
            return s.flagGet(od) ? 'continue' : 'skip';
        }
        if (op === 'ISG') return s.isg(false) ? 'skip' : 'continue';
        if (op === 'DSE') return s.isg(true) ? 'skip' : 'continue';

        /* spec 15.9: RCL Sigma+ as a program instruction */
        if (op === 'RCLSIGMA') {
            s.rclSigma();
            return s.error != null ? 'halt' : 'continue';
        }
        if (op === 'STO' || op === 'RCL') {
            s.doReg(op, od.reg, od.op);
            return s.error != null ? 'halt' : 'continue';
        }
        if (op === 'FIX' || op === 'SCI' || op === 'ENG') {
            s.display = {
                mode: op,
                n: (op === 'SCI' || op === 'ENG') ? Math.min(od, 7) : od
            };
            return 'continue';
        }
        if (op === 'DEG' || op === 'RAD' || op === 'GRAD') {
            s.trigMode = op;
            return 'continue';
        }
        if (op === 'USER') {
            s.user = !s.user;
            return 'continue';
        }
        if (op === 'CLRREG') {
            for (let i = 0; i < 20; i++) s.reg[i] = 0;
            s.I = 0;
            return 'continue';
        }
        if (op === 'CLRSIGMA') {
            if (!s.statsAvailable()) {
                s.error = 3;
                return 'halt';
            }
            for (let j = 0; j < 6; j++) s.reg[j] = 0;
            s.t = 0;
            s.z = 0;
            s.y = 0;
            s.x = 0;
            s.liftEnabled = false;
            s.editing = false;
            return 'continue';
        }
        if (op === 'enter') {
            s.lift();
            s.liftEnabled = false;
            s.editing = false;
            return 'continue';
        }
        if (op === 'swap') {
            const t = s.x;
            s.x = s.y;
            s.y = t;
            s.liftEnabled = true;
            return 'continue';
        }
        if (op === 'rdn') {
            const a = s.x;
            s.x = s.y;
            s.y = s.z;
            s.z = s.t;
            s.t = a;
            s.liftEnabled = true;
            return 'continue';
        }
        if (op === 'rup') {
            const b = s.x;
            s.x = s.t;
            s.t = s.z;
            s.z = s.y;
            s.y = b;
            s.liftEnabled = true;
            return 'continue';
        }
        if (op === 'lstx') {
            if (s.liftEnabled) s.lift();
            s.x = s.lastX;
            s.liftEnabled = true;
            return 'continue';
        }
        if (op === 'pi') {
            s.push(round10(Math.PI));
            return 'continue';
        }
        if (op === 'clx') {
            s.x = 0;
            s.liftEnabled = false;
            s.editing = false;
            return 'continue';
        }
        if (op === 'XSWAPI') {
            const cc = s.x;
            s.x = s.I;
            s.I = cc;
            s.liftEnabled = true;
            return 'continue';
        }
        if (op === 'XEXI') {
            s.exchangeIndirect();
            return s.error != null ? 'halt' : 'continue';
        }
        if (op === 'Iop') {
            s.regPush('I');
            return s.error != null ? 'halt' : 'continue';
        }
        if (op === 'IND') {
            s.regPush('IND');
            return s.error != null ? 'halt' : 'continue';
        }
        if (op === 'dot') {
            s.dot();
            return 'continue';
        }
        if (op === 'EEX') {
            s.eex();
            return 'continue';
        }
        if (ENTRY[op]) {
            s.digit(+op.charAt(1));
            return 'continue';
        }
        if (op === 'chs') {
            s.chs();
            return 'continue';
        }
        if (op === 'RAN') {
            s.random();
            return 'continue';
        }
        s.mathAct(op);
        if (s.error != null) return 'halt';
        if (s.overflowed()) return 'halt';
        return 'continue';
    }

    stepOne() {
        const len = this.programMemory.length;
        if (len === 0) {
            this.pc = 0;
            return;
        }
        if (this.pc === 0) this.pc = 1;
        if (this.pc < 1 || this.pc > len) {
            this.pc = 0;
            return;
        }
        const dir = this.execLine(this.pc - 1);
        if (dir === 'halt') {
            if (this.pc < 1 || this.pc > len) this.pc = 0;
            return;
        }
        if (dir === 'skip') this.pc += 2;
        else if (dir !== 'branch') this.pc += 1;
        if (this.pc < 1 || this.pc > len) this.pc = 0;
    }

    nextRunLine() {
        const len = this.programMemory.length;
        if (len === 0) return 0;
        let line = this.pc;
        if (line === 0) line = 1;
        if (line < 1 || line > len) return 0;
        return line;
    }

    runStep() {
        const len = this.programMemory.length;
        if (len === 0) return;
        if (this.pc === 0) this.pc = 1;
        if (this.pc < 1 || this.pc > len) {
            this.error = 4;
            return;
        }
        const dir = this.execLine(this.pc - 1);
        if (dir === 'halt') {
            if (this.pc < 1 || this.pc > len) this.pc = 0;
            return;
        }
        if (dir === 'pause') this.pc++;
        else if (dir === 'skip') this.pc += 2;
        else if (dir !== 'branch') this.pc += 1;
        if (this.pc > len) this.pc = 0;
    }

    /* ---- display cells ---- */
    overflowCells(v) {
        const c = [];
        if (v < 0) c.push({ sign: 1 });
        c.push({ d: '9', dot: 1 });
        for (let i = 0; i < 6; i++) c.push({ d: '9' });
        c.push({ gap: 1 });
        c.push({ ed: '9' });
        c.push({ ed: '9' });
        return c;
    }

    fmtX() {
        let v = this.x;
        if (!isFinite(v) || Math.abs(v) >= MAX_NUMBER) {
            return { cells: this.overflowCells(v) };
        }
        if (v !== 0 && Math.abs(v) < 1e-99) v = 0;
        const mo = this.display.mode;
        const n = this.display.n;
        if (mo === 'FIX') return this.fix(v, n);
        if (mo === 'SCI') return this.sci(v, n, false);
        return this.eng(v, n);
    }

    fmt() {
        if (this.off) return { cells: [] };
        if (this.prError) return { prError: true };
        if (this.error != null) return { error: this.error };
        if (this.previewLine != null) {
            return { program: true, cells: this.prgmCellsFor(this.previewLine) };
        }
        if (this.memHeld) return this.memCells();
        if (this.mantissa) return this.mantCells();
        if (this.programMode) {
            return { program: true, cells: this.prgmCells() };
        }
        if (this.editing) {
            const b = this.buf;
            if (!b || (b.man === '' && !b.inExp)) {
                return this.fmtX();
            }
            let c = this.bufCells();
            if (!c.cells || !c.cells.length) c = { cells: [{ d: '0' }] };
            return c;
        }
        return this.fmtX();
    }

    grp(ip) {
        const re = /\B(?=(\d{3})+(?!\d))/g;
        return ip.replace(re, this.sep);
    }

    fix(v, n) {
        const c = [];
        if (v < 0) c.push({ sign: 1 });
        const abs = Math.abs(v);
        const ip0 = Math.floor(abs + 1e-12).toString();
        const idd = ip0.length;
        if (idd > 10) return this.sci(v, n, false);
        if (v !== 0 && abs < 0.5 * Math.pow(10, -n)) {
            return this.sci(v, n, false);
        }
        const dec = Math.min(n, 10 - idd);
        const dp = decParts(abs, dec);
        const ipRaw = dp.ip;
        if (ipRaw.length > 10) return this.sci(v, n, false);
        const ip = this.grp(ipRaw);
        const fp = dp.fp;
        let ch;
        for (let i = 0; i < ip.length; i++) {
            ch = ip.charAt(i);
            if (ch === this.sep) {
                for (let j = c.length - 1; j >= 0; j--) {
                    if (c[j].d != null) {
                        c[j].comma = 1;
                        break;
                    }
                }
            } else {
                c.push({ d: ch });
            }
        }
        /* the ROM always draws the radix mark, even at 0 fraction digits */
        for (let i = c.length - 1; i >= 0; i--) {
            if (c[i].d != null) {
                c[i].dot = 1;
                break;
            }
        }
        for (let i = 0; i < fp.length; i++) {
            c.push({ d: fp.charAt(i) });
        }
        return { cells: c };
    }

    sci(v, n, ov) {
        const c = [];
        if (v < 0) c.push({ sign: 1 });
        const a = Math.abs(v);
        let e;
        let m;
        if (ov || a === 0) {
            e = a === 0 ? 0 : 99;
            m = a === 0 ? 0 : 9.999999999;
        } else {
            e = Math.floor(Math.log10(a));
            m = a / Math.pow(10, e);
        }
        const dec = Math.min(Math.max(n, 0), 9);
        let dp = decParts(m, dec);
        if (dp.ip.length > 1) {
            m = m / 10;
            e += 1;
            if (e > 99) return { cells: this.overflowCells(v) };
            dp = decParts(m, dec);
        }
        const ip = dp.ip;
        const fp = dp.fp;
        const sd = Math.min(dec, 6);
        for (let i = 0; i < ip.length; i++) c.push({ d: ip.charAt(i) });
        /* the ROM always draws the radix mark */
        for (let i = c.length - 1; i >= 0; i--) {
            if (c[i].d != null) {
                c[i].dot = 1;
                break;
            }
        }
        for (let i = 0; i < sd; i++) c.push({ d: fp.charAt(i) || '0' });
        c.push({ gap: 1 });
        if (e < 0) c.push({ es: 1 });
        let es = String(Math.abs(e));
        if (es.length < 2) es = '0' + es;
        for (let i = 0; i < es.length; i++) c.push({ ed: es.charAt(i) });
        return { cells: c };
    }

    eng(v, n) {
        const c = [];
        if (v < 0) c.push({ sign: 1 });
        const a = Math.abs(v);
        let e3;
        let m;
        if (a === 0) {
            e3 = 0;
            m = 0;
        } else {
            const e = Math.floor(Math.log10(a));
            e3 = e - ((e % 3 + 3) % 3);
            m = a / Math.pow(10, e3);
        }
        const ts = n + 1;
        let idd = m === 0 ? 1 : Math.max(1, Math.min(3, Math.floor(Math.log10(m)) + 1));
        let dec = Math.max(0, ts - idd);
        let dp = decParts(m, dec);
        if (dp.ip.length > 3) {
            const sh = dp.ip.length - 3;
            e3 += sh;
            m /= Math.pow(10, sh);
            idd = 3;
            dec = Math.max(0, ts - idd);
            dp = decParts(m, dec);
        }
        if (e3 > 99) {
            return { cells: this.overflowCells(v) };
        }
        const ip = dp.ip;
        const fp = dp.fp;
        const sd = Math.min(dec, 6);
        for (let i = 0; i < ip.length; i++) c.push({ d: ip.charAt(i) });
        /* the ROM always draws the radix mark */
        for (let i = c.length - 1; i >= 0; i--) {
            if (c[i].d != null) {
                c[i].dot = 1;
                break;
            }
        }
        for (let i = 0; i < sd; i++) c.push({ d: fp.charAt(i) || '0' });
        c.push({ gap: 1 });
        if (e3 < 0) c.push({ es: 1 });
        let es = String(Math.abs(e3));
        if (es.length < 2) es = '0' + es;
        for (let i = 0; i < es.length; i++) c.push({ ed: es.charAt(i) });
        return { cells: c };
    }

    mantCells() {
        const c = [];
        const x = this.x;
        if (x < 0) c.push({ sign: 1 });
        const a = Math.abs(x);
        let m;
        if (!isFinite(a) || a >= MAX_NUMBER) {
            m = '9999999999';
        } else if (a === 0) {
            m = '0000000000';
        } else {
            const e = Math.floor(Math.log10(a));
            m = (a / Math.pow(10, e)).toFixed(9).replace('.', '');
            if (m.length > 10) m = m.slice(0, 10);
            while (m.length < 10) m += '0';
        }
        for (let i = 0; i < m.length; i++) c.push({ d: m.charAt(i) });
        return { cells: c };
    }

    bufCells() {
        const b = this.buf;
        const c = [];
        if (b.neg) c.push({ sign: 1 });
        let m = b.man || '0';
        if (m.charAt(0) === '.') m = '0' + m;
        const di = m.indexOf('.');
        const ip = di < 0 ? m : m.slice(0, di);
        const fp = di < 0 ? '' : m.slice(di + 1);
        /* the ROM groups the integer part as digits are keyed (manual p.18) */
        const grouped = this.grp(ip);
        for (let i = 0; i < grouped.length; i++) {
            const ch = grouped.charAt(i);
            if (ch === this.sep) {
                for (let j = c.length - 1; j >= 0; j--) {
                    if (c[j].d != null) {
                        c[j].comma = 1;
                        break;
                    }
                }
            } else {
                c.push({ d: ch });
            }
        }
        if (di >= 0) {
            for (let j = c.length - 1; j >= 0; j--) {
                if (c[j].d != null) {
                    c[j].dot = 1;
                    break;
                }
            }
        }
        for (let i = 0; i < fp.length; i++) c.push({ d: fp.charAt(i) });
        if (b.inExp || b.exp !== '') {
            c.push({ gap: 1 });
            if (b.expNeg) c.push({ es: 1 });
            const e = b.exp || (b.inExp ? '0' : '');
            for (let i = 0; i < e.length; i++) c.push({ ed: e.charAt(i) });
        }
        return { cells: c };
    }

    memCells() {
        const remaining = Math.max(0, this.programCapacity - this.programMemory.length);
        const p = String(Math.min(99, remaining)).padStart(2, '0');
        let nextReg;
        if (this.convertedCount >= CONVERSION_ORDER.length) {
            nextReg = '?';
        } else {
            const reg = CONVERSION_ORDER[this.convertedCount];
            nextReg = reg >= 10 ? ('.' + (reg - 10)) : String(reg);
        }
        /* ROM physical layout: p-xx  r- .x  (two blanks before the r field,
           radix mark in d9, register/state digit in d10) */
        const chars = ['p', '-', p[0], p[1], ' ', ' ', 'r', '-'];
        if (nextReg === '?') {
            chars.push('?');
        } else if (nextReg.charAt(0) === '.') {
            chars.push('', nextReg.charAt(1));   /* '' becomes blank + dot */
        } else {
            chars.push(nextReg);
        }
        return {
            cells: chars.map(function (ch) {
                if (ch === '') return { d: ' ', dot: 1 };
                return { d: ch };
            })
        };
    }

    /* ---- program line display ---- */
    prgmCellsFor(line) {
        const cells = [];
        let ls = String(line);
        while (ls.length < 3) ls = '0' + ls;
        for (let i = 0; i < ls.length; i++) cells.push({ d: ls.charAt(i) });
        cells.push({ d: '-' });
        let ins = null;
        if (line >= 1 && line <= this.programMemory.length) {
            ins = this.programMemory[line - 1];
        }
        let elems = [];
        if (ins && ins.codes) {
            for (let i = 0; i < ins.codes.length; i++) {
                if (ins.codes[i] != null) elems.push(String(ins.codes[i]));
            }
        }
        if (elems.length > 3) elems = elems.slice(0, 3);
        function pad2(s) {
            if (s.length >= 2) return s.slice(-2);
            if (s.length === 1) return ' ' + s;
            return '  ';
        }
        function appendChars(arr, s) {
            for (let j = 0; j < s.length; j++) arr.push(s.charAt(j));
        }
        const chars = [];
        if (elems.length === 0) {
            for (let i = 0; i < 6; i++) chars.push({ ch: ' ' });
        } else if (elems.length === 1) {
            const one = elems[0].split('');
            while (one.length < 6) one.unshift(' ');
            for (let i = 0; i < one.length; i++) chars.push({ ch: one[i] });
        } else if (elems.length === 2) {
            const two = [];
            appendChars(two, elems[0]);
            two.push(' ');
            appendChars(two, elems[1]);
            while (two.length < 6) two.unshift(' ');
            for (let i = 0; i < two.length; i++) chars.push({ ch: two[i] });
        } else {
            const f1 = pad2(elems[0]).split('');
            const f2 = pad2(elems[1]).split('');
            const f3 = pad2(elems[2]).split('');
            const three = f1.concat(f2, f3);
            for (let i = 0; i < three.length; i++) {
                chars.push({
                    ch: three[i],
                    dot: three[i] !== ' ' && (i === 1 || i === 3)
                });
            }
        }
        for (let i = 0; i < chars.length; i++) {
            if (chars[i].ch === ' ') cells.push({ d: ' ' });
            else cells.push({ d: chars[i].ch, dot: !!chars[i].dot });
        }
        return cells;
    }

    prgmCells() {
        return this.prgmCellsFor(this.pc);
    }

    /* ---- Continuous Memory ---- */
    serialize() {
        return {
            v: 1,
            t: this.t,
            z: this.z,
            y: this.y,
            x: this.x,
            lastX: this.lastX,
            I: this.I,
            reg: this.reg.slice(),
            ranState: this.ranState,
            trigMode: this.trigMode,
            dispMode: this.display.mode,
            dispN: this.display.n,
            radix: this.radix,
            sep: this.sep,
            user: this.user,
            lowbat: this.lowbat,
            flags: this.flagValues.slice(),
            mem: this.programMemory,
            pc: this.pc,
            ret: this.retStack.slice(),
            cap: this.programCapacity,
            conv: this.convertedCount,
            lift: this.liftEnabled
        };
    }

    restore(o) {
        if (!o || o.v !== 1) return;
        this.reset();
        function num(q, d) {
            return (typeof q === 'number' && isFinite(q)) ? q : d;
        }
        this.t = num(o.t, 0);
        this.z = num(o.z, 0);
        this.y = num(o.y, 0);
        this.x = num(o.x, 0);
        this.lastX = num(o.lastX, 0);
        this.I = num(o.I, 0);
        if (Array.isArray(o.reg) && o.reg.length === 20) {
            this.reg = o.reg.map(function (q) { return num(q, 0); });
        }
        this.ranState = num(o.ranState, 0);
        if (o.trigMode === 'DEG' || o.trigMode === 'RAD' || o.trigMode === 'GRAD') {
            this.trigMode = o.trigMode;
        }
        if (o.dispMode === 'FIX' || o.dispMode === 'SCI' || o.dispMode === 'ENG') {
            this.display.mode = o.dispMode;
        }
        let dn = num(o.dispN, 2);
        if (this.display.mode === 'SCI' || this.display.mode === 'ENG') {
            dn = Math.min(dn, 7);
        }
        this.display.n = Math.min(9, Math.max(0, dn));
        if (o.radix === '.' || o.radix === ',') this.radix = o.radix;
        if (o.sep === '.' || o.sep === ',') this.sep = o.sep;
        this.user = !!o.user;
        this.lowbat = !!o.lowbat;
        if (Array.isArray(o.flags) && o.flags.length >= 2) {
            this.flagValues = [!!o.flags[0], !!o.flags[1]];
        }
        if (Array.isArray(o.mem)) {
            this.programMemory = o.mem.filter(function (ins) {
                return ins && typeof ins.op === 'string';
            });
        }
        this.pc = Math.max(0, Math.min(this.programMemory.length, num(o.pc, 0)));
        if (Array.isArray(o.ret)) {
            this.retStack = o.ret.filter(function (q) {
                return typeof q === 'number' && isFinite(q);
            });
        }
        this.programCapacity = Math.max(63, Math.min(203, num(o.cap, 63)));
        this.convertedCount = Math.max(0, Math.min(20, num(o.conv, 0)));
        this.liftEnabled = !!o.lift;
        this.programMode = false;
        this.off = false;
    }
}

/* ---- exports ---- */
window.Engine = Engine;
window.LEG = LEG;
window.KEYMAP = KEYMAP;
