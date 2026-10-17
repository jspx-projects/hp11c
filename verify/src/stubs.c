/*
 * stubs.c - headless build substitutes for GUI/audio modules that the
 *           Nonpareil sim core references but which we don't need to run
 *           the Nut CPU headlessly.
 */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

#include "chip.h"
#include "sound.h"

/* GUI-only chip installers referenced by the chip-install table. */
chip_t *gui_printer_install(struct sim_t *sim, struct plugin_module_t *module,
                            chip_type_t type, int32_t index, int32_t flags)
{
    (void) sim; (void) module; (void) type; (void) index; (void) flags;
    return NULL;
}

chip_t *gui_card_reader_install(struct sim_t *sim, struct plugin_module_t *module,
                                chip_type_t type, int32_t index, int32_t flags)
{
    (void) sim; (void) module; (void) type; (void) index; (void) flags;
    return NULL;
}

/* util.c calls this on fatal(); the GUI front-end normally provides it. */
void usage(FILE *f)
{
    fprintf(f, "hp11c-sim: headless HP-11C (Nonpareil Nut core) harness\n"
               "usage: hp11c-sim [-n 11c.ncd] [-f script] [-b boot_ms]\n");
}

/* proc_nut.c drives the "bender" (piezo) through these.  Headless = silent. */
int synth_sound(float frequency, float amplitude, float duration,
                sample_t *waveform_table, uint32_t waveform_table_length)
{
    (void) frequency; (void) amplitude; (void) duration;
    (void) waveform_table; (void) waveform_table_length;
    return -1;
}

bool stop_sound(int id)
{
    (void) id;
    return false;
}

sample_t squarewave_waveform_table[1] = { 0 };
uint32_t squarewave_waveform_table_length = 0;
