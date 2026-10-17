/*
 * headless.c - headless front-end for the Nonpareil Nut/Voyager simulator
 *              driving the original HP-11C ROM.
 *
 * Part of the HP-11C verification tool suite.  Reuses Nonpareil's sim core
 * (proc.c + proc_nut.c + voyager_lcd.c) but replaces the GTK front-end with
 * a small line-oriented command interpreter so the ROM can be exercised from
 * scripts and its LCD compared against the JS reimplementation.
 *
 * Protocol (one command per line on stdin):
 *     <n>              press+release user keycode <n> (see keys.h)
 *     key <n>          same as above
 *     hold <n> <ms>    press <n>, wait <ms>, release
 *     wait <ms>        advance simulation, no key
 *     dump             print the current LCD state
 *     reset            sim_reset()
 *     bind <s>         press+release a whole string of keycodes, e.g. "37 38"
 *     # ...            comment
 *     quit             exit
 *
 * After every action the LCD is printed as:
 *     <step> key=<n> glass=<sign+10 cols> ann=<hex>
 * where glass is position 0 (sign, '-' or ' ') followed by the ten digit
 * columns; a '.' or ',' is appended to the column that carries it.
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <time.h>
#include <sys/select.h>

#include <glib.h>

#include "keyboard.h"
#include "display.h"
#include "chip.h"
#include "calcdef.h"
#include "proc.h"

/* Provided by the optional Nonpareil verify patch; weak so this still builds
   and runs against an unpatched Nonpareil checkout (coverage unavailable). */
extern void nut_dump_coverage(const char *path) __attribute__((weak));

/* ------------------------------------------------------------------ */
/* captured display state (written from the GUI thread only)          */
/* ------------------------------------------------------------------ */
#define MAXD 64
static sim_t *g_sim;
static int  g_nseg;
static segment_bitmap_t g_seg[MAXD];
static long g_updated;

static void display_cb(void *ref, int digit_count, segment_bitmap_t *segments)
{
    (void) ref;
    if (digit_count > MAXD) digit_count = MAXD;
    g_nseg = digit_count;
    for (int i = 0; i < digit_count; i++)
        g_seg[i] = segments[i];
    g_updated++;
}

static void pump(void)
{
    int guard = 0;
    while (g_main_context_pending(NULL) && guard++ < 100000)
        g_main_context_iteration(NULL, FALSE);
}

static void msleep(int ms)
{
    if (ms > 0)
        g_usleep((gulong) ms * 1000);
}

/* ------------------------------------------------------------------ */
/* 7-segment decode: bits a..g = bits 0..6, h(.)=7, i(,)=8           */
/* ------------------------------------------------------------------ */
static char segtab[128];

static void init_segtab(void)
{
    static const struct { unsigned m; char c; } t[] = {
        {0x3f,'0'}, {0x06,'1'}, {0x5b,'2'}, {0x4f,'3'}, {0x66,'4'},
        {0x6d,'5'}, {0x7d,'6'}, {0x07,'7'}, {0x7f,'8'}, {0x6f,'9'},
        {0x40,'-'}, {0x79,'E'}, {0x50,'r'}, {0x5c,'o'}, {0x73,'P'},
        {0x00,' '}
    };
    memset(segtab, '?', sizeof(segtab));
    for (unsigned i = 0; i < sizeof(t)/sizeof(t[0]); i++)
        segtab[t[i].m] = t[i].c;
}

static void format_glass(char *out, int maxlen)
{
    int p = 0;
    unsigned s0 = (g_nseg > 0) ? g_seg[0] : 0;
    if (p < maxlen - 1) out[p++] = (s0 & 0x40) ? '-' : ' ';
    for (int i = 1; i <= 10; i++) {
        unsigned m = 0, full = 0;
        if (i < g_nseg) { full = g_seg[i]; m = full & 0x7f; }
        char c = segtab[m];
        if (p < maxlen - 1) out[p++] = c;
        if (i < g_nseg) {
            /* segment h = dot; h+i together = comma (dot + tail) */
            int h = (full >> 7) & 1;
            int t = (full >> 8) & 1;
            if (h && t) { if (p < maxlen - 1) out[p++] = ','; }
            else if (h) { if (p < maxlen - 1) out[p++] = '.'; }
            else if (t) { if (p < maxlen - 1) out[p++] = ','; }
        }
    }
    out[p] = 0;
}

static unsigned long ann_mask(void)
{
    unsigned long m = 0;
    for (int i = 0; i < g_nseg; i++)
        if (g_seg[i] & SEGMENT_ANN)
            m |= (1UL << i);
    return m;
}

static void print_display(const char *tag)
{
    char glass[64];
    format_glass(glass, sizeof(glass));
    printf("%-12s glass=[%s] ann=0x%lx upd=%ld run=%d",
           tag, glass, ann_mask(), g_updated, sim_running(g_sim) ? 1 : 0);
    if (getenv("HP11C_DEBUG_RAM")) {
        for (int a = 8; a <= 10; a++) {
            uint64_t v = 0;
            if (sim_read_ram(g_sim, (addr_t) a, &v))
                printf(" ram[%d]=0x%llx", a, (unsigned long long) v);
        }
    }
    printf("\n");
    fflush(stdout);
}

/* ------------------------------------------------------------------ */
/* command processing                                                 */
/* ------------------------------------------------------------------ */
static int g_hold_ms = 120;  /* key hold */
static int g_settle_ms = 220; /* time for firmware to react + display */
static int g_fast;            /* turbo wall-clock scaling active */
static long g_step;

static void do_key(int kc)
{
    g_step++;
    sim_key(g_sim, kc, true);
    msleep(g_hold_ms);
    sim_key(g_sim, kc, false);
    msleep(g_settle_ms);
    pump();
    {
        char tag[32];
        snprintf(tag, sizeof(tag), "%ld key=%d", g_step, kc);
        print_display(tag);
    }
}

static long now_ms(void);

static void run_script(FILE *f)
{
    char line[4096];
    while (fgets(line, sizeof(line), f)) {
        char *s = line;
        while (*s == ' ' || *s == '\t') s++;
        if (*s == 0 || *s == '\n' || *s == '#') continue;
        if (strncmp(s, "quit", 4) == 0) break;
        if (strncmp(s, "dump", 4) == 0) {
            pump();
            char tag[32];
            snprintf(tag, sizeof(tag), "%ld dump", g_step);
            print_display(tag);
            continue;
        }
        if (strncmp(s, "reset", 5) == 0) {
            sim_reset(g_sim);
            msleep(200);
            pump();
            printf("reset\n");
            continue;
        }
        if (strncmp(s, "wait", 4) == 0) {
            int ms = 0; sscanf(s + 4, "%d", &ms);
            msleep(ms);
            pump();
            continue;
        }
        if (strncmp(s, "hold", 4) == 0) {
            int kc = 0, ms = g_hold_ms;
            sscanf(s + 4, "%d %d", &kc, &ms);
            g_step++;
            sim_key(g_sim, kc, true);
            msleep(ms);
            sim_key(g_sim, kc, false);
            msleep(g_settle_ms);
            pump();
            char tag[48];
            snprintf(tag, sizeof(tag), "%ld hold=%d/%d", g_step, kc, ms);
            print_display(tag);
            continue;
        }
        if (strncmp(s, "down", 4) == 0) {
            int kc = 0;
            sscanf(s + 4, "%d", &kc);
            sim_key(g_sim, kc, true);
            msleep(g_hold_ms);
            pump();
            continue;
        }
        if (strncmp(s, "up", 2) == 0) {
            int kc = 0;
            sscanf(s + 2, "%d", &kc);
            sim_key(g_sim, kc, false);
            msleep(g_settle_ms);
            pump();
            continue;
        }
        if (strncmp(s, "settle", 6) == 0) {
            int maxms = 2500;
            sscanf(s + 6, "%d", &maxms);
            long t0 = now_ms();
            char prev[64] = "";
            long stable_since = now_ms();
            long stable_needed = g_fast ? 60 : 250;
            while (now_ms() - t0 < maxms) {
                pump();
                char g[64];
                format_glass(g, sizeof(g));
                int blank = 1;
                for (int i = 0; g[i]; i++) if (g[i] != ' ') { blank = 0; break; }
                if (strcmp(g, prev) != 0) {
                    strncpy(prev, g, sizeof(prev) - 1);
                    prev[sizeof(prev) - 1] = 0;
                    stable_since = now_ms();
                } else if (!blank && now_ms() - stable_since >= stable_needed) {
                    break;
                }
                msleep(g_fast ? 5 : 20);
            }
            pump();
            continue;
        }
        if (strncmp(s, "bind", 4) == 0) {
            int kc;
            char *q = s + 4;
            while (sscanf(q, "%d", &kc) == 1) {
                do_key(kc);
                while (*q && *q != ' ' && *q != '\t') q++;
                while (*q == ' ' || *q == '\t') q++;
            }
            continue;
        }
        /* bare keycode, possibly with leading 'key ' */
        {
            char *q = s;
            if (strncmp(q, "key", 3) == 0) q += 3;
            int kc = -1;
            if (sscanf(q, "%d", &kc) == 1 && kc >= 0 && kc <= 99) {
                do_key(kc);
                continue;
            }
        }
        printf("? unknown command: %s", s);
    }
}

static long now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

/*
 * Streaming mode: continuously emit the LCD whenever it changes, and accept
 * key commands on stdin.  One line per distinct frame:
 *     glass=[<sign+10 cols>] ann=<hex>
 * The bridge (bridge.py) relays this to a browser.
 */
static void stream_mode(void)
{
    char last_glass[64] = "";
    unsigned long last_ann = ~0UL;
    int pending_key = -1;
    long release_at = 0;
    char inbuf[4096];
    int inlen = 0;

    fcntl(fileno(stdin), F_SETFL, O_NONBLOCK);

    for (;;) {
        /* release a held key when its time is up */
        if (pending_key >= 0 && now_ms() >= release_at) {
            sim_key(g_sim, pending_key, false);
            pending_key = -1;
        }

        /* read any commands already waiting */
        int r = read(fileno(stdin), inbuf + inlen, sizeof(inbuf) - 1 - inlen);
        if (r > 0) {
            inlen += r;
            inbuf[inlen] = 0;
            char *line = inbuf;
            char *nl;
            while ((nl = strchr(line, '\n')) != NULL) {
                *nl = 0;
                int kc = -1, hms = -1;
                if (sscanf(line, "key %d", &kc) == 1 ||
                    sscanf(line, "hold %d %d", &kc, &hms) == 2 ||
                    sscanf(line, "%d", &kc) == 1) {
                    if (kc >= 0 && kc <= 99) {
                        if (pending_key >= 0) sim_key(g_sim, pending_key, false);
                        sim_key(g_sim, kc, true);
                        pending_key = kc;
                        release_at = now_ms() + (hms > 0 ? hms : g_hold_ms);
                    }
                } else if (strncmp(line, "reset", 5) == 0) {
                    sim_reset(g_sim);
                } else if (strncmp(line, "quit", 4) == 0) {
                    return;
                }
                line = nl + 1;
            }
            inlen = strlen(line);
            memmove(inbuf, line, inlen + 1);
        }

        pump();

        char glass[64];
        format_glass(glass, sizeof(glass));
        unsigned long ann = ann_mask();
        if (strcmp(glass, last_glass) != 0 || ann != last_ann) {
            printf("glass=[%s] ann=0x%lx\n", glass, ann);
            fflush(stdout);
            strncpy(last_glass, glass, sizeof(last_glass) - 1);
            last_glass[sizeof(last_glass) - 1] = 0;
            last_ann = ann;
        }

        msleep(15);
    }
}

int main(int argc, char *argv[])
{
    const char *ncd = "build/11c.ncd";
    const char *script = NULL;
    int boot_ms = 250;
    int stream = 0;
    int fast = 0;
    int boot_set = 0, hold_set = 0, settle_set = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-n") == 0 && i + 1 < argc) ncd = argv[++i];
        else if (strcmp(argv[i], "-b") == 0 && i + 1 < argc) { boot_ms = atoi(argv[++i]); boot_set = 1; }
        else if (strcmp(argv[i], "--hold") == 0 && i + 1 < argc) { g_hold_ms = atoi(argv[++i]); hold_set = 1; }
        else if (strcmp(argv[i], "--settle") == 0 && i + 1 < argc) { g_settle_ms = atoi(argv[++i]); settle_set = 1; }
        else if (strcmp(argv[i], "--fast") == 0) fast = 1;
        else if (strcmp(argv[i], "--stream") == 0) stream = 1;
        else if (strcmp(argv[i], "-f") == 0 && i + 1 < argc) script = argv[++i];
        else script = argv[i];
    }

    if (fast) {
        /* 200x real time (see NONPAREIL_TURBO in Nonpareil proc.c).  Scale the
           wall-clock holds accordingly; firmware timing is cycle-based. */
        setenv("NONPAREIL_TURBO", "200", 1);
        g_fast = 1;
        if (!boot_set) boot_ms = 30;
        /* Keep the key hold below 1 second of simulated time; otherwise the
           firmware's held-SST/BST auto-repeat kicks in and adds a step. */
        if (!hold_set) g_hold_ms = 4;
        if (!settle_set) g_settle_ms = 12;
    }

    init_segtab();

    g_sim = sim_init((char *) ncd, display_cb, NULL);
    if (!g_sim) { fprintf(stderr, "sim_init failed\n"); return 1; }

    sim_start(g_sim);
    msleep(boot_ms);
    pump();
    print_display("boot");

    if (getenv("HP11C_DEBUG_LCD")) {
        calcdef_t *cd = sim_get_calcdef(g_sim);
        for (int d = 1; d <= 2; d++)
            for (int s = 0; s < 10; s++) {
                uint16_t reg = 0xffff; uint8_t bit = 0xff;
                bool v = calcdef_get_lcd_segment(cd, d, s, &reg, &bit);
                fprintf(stderr, "lcdseg d=%d s=%d valid=%d reg=%u bit=%u\n",
                        d, s, v, reg, bit);
            }
    }

    if (stream) {
        stream_mode();
    } else if (script) {
        FILE *f = fopen(script, "r");
        if (!f) { perror(script); return 1; }
        run_script(f);
        fclose(f);
    } else {
        run_script(stdin);
    }

    {
        const char *cov = getenv("HP11C_COV_FILE");
        if (cov && *cov) {
            if (nut_dump_coverage)
                nut_dump_coverage(cov);
            else
                fprintf(stderr, "coverage: apply verify/patches/nonpareil-verify.patch first\n");
        }
    }
    sim_quit(g_sim);
    return 0;
}
