# Build the HP-11C verification tools against the Nonpareil Nut simulator core.
#
#   make            build bin/build_ncd and bin/hp11c-sim
#   make ncd        regenerate build/11c.ncd from the model + ROM
#   make clean

# Nonpareil is not redistributed here.  Clone it next to this repo (or override):
#   git clone https://github.com/brouhaha/nonpareil.git nonpareil
#   make -C verify NONP=../nonpareil ncd && make -C verify NONP=../nonpareil
NONP    ?= ../nonpareil
SRC     := $(NONP)/src
BUILD   := build
BIN     := bin

PKGCFG  := pkg-config
XML_CF  := $(shell $(PKGCFG) --cflags libxml-2.0)
XML_LIB := $(shell $(PKGCFG) --libs libxml-2.0)
GLIB_CF := $(shell $(PKGCFG) --cflags glib-2.0)
GLIB_LIB:= $(shell $(PKGCFG) --libs glib-2.0 gthread-2.0)

CFLAGS  := -std=gnu99 -O2 -I$(SRC) -I$(NONP)/build/common $(XML_CF) $(GLIB_CF)
LDFLAGS :=
LIBS    := $(GLIB_LIB) $(XML_LIB) -lpthread -lm

# --- Nonpareil sources used by the headless core ---------------------------
COMMON_SRC := util.c arch.c platform.c xmlutil.c release.c

SIMCORE_SRC := calcdef.c chip.c proc.c digit_ops.c \
               proc_classic.c proc_woodstock.c crc.c pick.c \
               proc_nut.c coconut_lcd.c phineas.c helios.c helios_chargen.c \
               hepax.c voyager_lcd.c mod1_file.c elapsed_time_us_posix.c \
               glib_async_queue_source.c dis_nut.c dis_woodstock.c

OUR_SRC := headless.c stubs.c

OBJS := $(patsubst %.c,$(BUILD)/%.o,$(COMMON_SRC)) \
        $(patsubst %.c,$(BUILD)/%.o,$(SIMCORE_SRC)) \
        $(patsubst %.c,$(BUILD)/verify_%.o,$(OUR_SRC))

.PHONY: all ncd clean deps fetch

all: $(BIN)/build_ncd $(BIN)/hp11c-sim

# One-command setup: clone Nonpareil, apply the optional patch, build.
# Nonpareil and its HP-11C ROM are not redistributed by this repository.
deps:
	./fetch-deps.sh

# Fetch/checkout only; build later with: make NONP=...
fetch:
	./fetch-deps.sh --no-build

# --- ncd builder (no glib needed) ------------------------------------------
$(BIN)/build_ncd: $(SRC)/build_ncd.c $(SRC)/util.c $(SRC)/arch.c \
                  $(SRC)/sha-256.c $(SRC)/endian.c $(SRC)/release.c
	@mkdir -p $(BIN)
	gcc -std=gnu99 -O2 -I$(SRC) $(XML_CF) -o $@ $^ $(XML_LIB)

ncd: $(BIN)/build_ncd
	@mkdir -p $(BUILD)
	$(BIN)/build_ncd $(NONP)/ncd/11c/11c.ncd.tmpl \
	    --obj-path $(NONP)/ncd/11c -o $(BUILD)/11c.ncd

# --- headless simulator ----------------------------------------------------
$(BUILD)/%.o: $(SRC)/%.c
	@mkdir -p $(BUILD)
	gcc $(CFLAGS) -c -o $@ $<

$(BUILD)/verify_%.o: src/%.c
	@mkdir -p $(BUILD)
	gcc $(CFLAGS) -c -o $@ $<

$(BIN)/hp11c-sim: $(OBJS)
	@mkdir -p $(BIN)
	gcc $(LDFLAGS) -o $@ $(OBJS) $(LIBS)

clean:
	rm -f $(BUILD)/*.o $(BIN)/hp11c-sim $(BIN)/build_ncd
