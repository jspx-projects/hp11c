#!/bin/sh
# Fetch and build the verification dependencies.
#
# Nonpareil and the HP-11C ROM are not redistributed in this repository.
# This script clones Nonpareil at the pinned commit (which includes the HP-11C
# model and ROM), applies the optional fast/coverage patch, and builds
# bin/build_ncd and bin/hp11c-sim.
#
# Usage: ./verify/fetch-deps.sh [options]
#
# Options:
#   --dest DIR     where to clone Nonpareil (default: <repo>/nonpareil)
#   --ref COMMIT   Nonpareil commit (default: pinned verification commit)
#   --no-patch     do not apply the fast/coverage patch
#   --no-build     fetch/checkout only
#   -h, --help     show this help

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERIFY="$ROOT/verify"
REF="c347bc1ab20170c253512042f7aac0d952f304ea"
DEST="$ROOT/nonpareil"
PATCH="$VERIFY/patches/nonpareil-verify.patch"
DO_PATCH=1
DO_BUILD=1

usage() {
    cat <<'EOF'
Usage: ./verify/fetch-deps.sh [options]

Fetches Nonpareil at the pinned commit (it contains the HP-11C model and ROM),
optionally applies the fast/coverage patch, and builds the verification tools.

Options:
  --dest DIR     where to clone Nonpareil (default: <repo>/nonpareil)
  --ref COMMIT   Nonpareil commit (default: pinned verification commit)
  --no-patch     do not apply the fast/coverage patch
  --no-build     fetch/checkout only
  -h, --help     show this help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dest)      [ $# -ge 2 ] || { echo "error: --dest needs a value" >&2; exit 2; }; DEST=$2; shift 2 ;;
        --ref)       [ $# -ge 2 ] || { echo "error: --ref needs a value" >&2; exit 2; }; REF=$2; shift 2 ;;
        --no-patch)  DO_PATCH=0; shift ;;
        --no-build)  DO_BUILD=0; shift ;;
        -h|--help)   usage; exit 0 ;;
        *)           echo "error: unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

# Resolve a relative destination against the caller's working directory.
case "$DEST" in
    /*) ;;
    *)  DEST="$PWD/$DEST" ;;
esac

echo "==> Nonpareil destination: $DEST"

if [ -d "$DEST/.git" ]; then
    echo "==> Using existing checkout"
    if ! git -C "$DEST" cat-file -e "$REF^{commit}" 2>/dev/null; then
        echo "==> Fetching origin"
        git -C "$DEST" fetch origin
    fi
    git -C "$DEST" checkout --detach "$REF"
elif [ -e "$DEST" ]; then
    echo "error: $DEST exists but is not a git checkout" >&2
    exit 1
else
    echo "==> Cloning https://github.com/brouhaha/nonpareil.git"
    git clone https://github.com/brouhaha/nonpareil.git "$DEST"
    git -C "$DEST" checkout --detach "$REF"
fi

if [ "$DO_PATCH" = 1 ]; then
    if [ ! -f "$PATCH" ]; then
        echo "warning: $PATCH not found; skipping patch" >&2
    elif git -C "$DEST" apply --reverse --check "$PATCH" 2>/dev/null; then
        echo "==> Fast/coverage patch already applied"
    elif git -C "$DEST" apply --check "$PATCH" 2>/dev/null; then
        git -C "$DEST" apply "$PATCH"
        echo "==> Applied verify/patches/nonpareil-verify.patch"
    else
        echo "warning: patch does not apply cleanly; continuing without it" >&2
    fi
fi

if [ ! -f "$DEST/ncd/11c/11c.rom" ]; then
    echo "warning: $DEST/ncd/11c/11c.rom is missing" >&2
    echo "         supply your own HP-11C ROM there before building the model" >&2
fi

if [ "$DO_BUILD" = 0 ]; then
    echo "==> Fetched. Next:"
    echo "    make -C verify ncd NONP=\"$DEST\""
    echo "    make -C verify NONP=\"$DEST\""
    exit 0
fi

if ! command -v make >/dev/null 2>&1 || ! command -v gcc >/dev/null 2>&1; then
    echo "error: make and gcc are required to build" >&2
    exit 1
fi
if ! command -v pkg-config >/dev/null 2>&1 ||
   ! pkg-config --exists glib-2.0 libxml-2.0 2>/dev/null; then
    echo "error: missing development packages (need glib-2.0 and libxml-2.0)" >&2
    echo "       Fedora:        sudo dnf install glib2-devel libxml2-devel" >&2
    echo "       Debian/Ubuntu: sudo apt install libglib2.0-dev libxml2-dev" >&2
    exit 1
fi

echo "==> Building verification tools"
make -C "$VERIFY" ncd NONP="$DEST"
make -C "$VERIFY" NONP="$DEST"

echo
echo "Done."
echo "  Browser GUI:      open hp11c.html (a local server is recommended)"
echo "  ROM-backed GUI:   python3 verify/bridge.py"
echo "  Differential run: python3 verify/audit.py --fast"
