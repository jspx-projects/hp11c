#!/usr/bin/env python3
"""
bridge.py - connect the browser HP-11C GUI to the real ROM simulator.

Spawns bin/hp11c-sim in streaming mode, serves the existing GUI assets, and
relays LCD frames to the browser over Server-Sent Events while forwarding key
presses from the browser back to the simulator.

Endpoints:
    GET  /                       the ROM-backed GUI page
    GET  /rom/<file>             files from this verify/ directory
    GET  /<file>                 files from the HP-11C directory (engine, png)
    GET  /events                 SSE stream of "glass=[...] ann=0x..." frames
    POST /key?n=<keycode>        press+release a key
    POST /reset                  reset the simulated CPU
    POST /power                  (alias: press ON)

Run:
    python3 bridge.py            then open http://localhost:8011/
"""

import json
import os
import posixpath
import queue
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
HP11C = os.path.dirname(HERE)
SIM = os.path.join(HERE, "bin", "hp11c-sim")
NCD = os.path.join(HERE, "build", "11c.ncd")
PORT = int(os.environ.get("HP11C_BRIDGE_PORT", "8011"))
HOLD_MS = int(os.environ.get("HP11C_BRIDGE_HOLD", "120"))

FRAME_RE = re.compile(r"glass=\[(.*?)\]\s*ann=(0x[0-9a-fA-F]+)")

# ------------------------------------------------------------------ simulator

class Sim:
    def __init__(self):
        self.proc = subprocess.Popen(
            [SIM, "-n", NCD, "--stream", "--hold", str(HOLD_MS)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1)
        self.lock = threading.Lock()
        self.subs = set()
        self.subs_lock = threading.Lock()
        self.last = None
        self.raw_last = None
        self.ready = os.environ.get("HP11C_BRIDGE_INIT", "1") == "0"
        self.thread = threading.Thread(target=self._reader, daemon=True)
        self.thread.start()
        if not self.ready:
            threading.Thread(target=self._init_sequence, daemon=True).start()

    def _init_sequence(self):
        """Power the ROM on and clear its cold-boot 'Pr Error' so the GUI
        starts at a clean 0.0000 (a real calculator shows Pr Error only after
        Continuous Memory is lost; clearing it is one key press).  Frames are
        not published until this completes."""
        time.sleep(0.6)
        self.key(41)          # ON
        time.sleep(0.7)
        self.key(35)          # back-arrow: consumes Pr Error, leaves X=0
        time.sleep(0.4)
        self.ready = True
        # publish the first clean frame to any early subscribers
        self.last = getattr(self, "raw_last", None)
        if self.last:
            with self.subs_lock:
                for q in list(self.subs):
                    try:
                        q.put_nowait(self.last)
                    except queue.Full:
                        pass

    def _reader(self):
        for line in self.proc.stdout:
            m = FRAME_RE.search(line)
            if not m:
                continue
            frame = {"glass": m.group(1), "ann": m.group(2)}
            self.raw_last = frame
            if not self.ready:
                continue
            self.last = frame
            with self.subs_lock:
                for q in list(self.subs):
                    try:
                        q.put_nowait(frame)
                    except queue.Full:
                        pass

    def subscribe(self):
        q = queue.Queue(maxsize=64)
        with self.subs_lock:
            self.subs.add(q)
        if self.last:
            q.put_nowait(self.last)
        return q

    def unsubscribe(self, q):
        with self.subs_lock:
            self.subs.discard(q)

    def _write(self, s):
        with self.lock:
            if self.proc.poll() is None:
                self.proc.stdin.write(s)
                self.proc.stdin.flush()

    def key(self, n):
        self._write("hold %d %d\n" % (int(n), HOLD_MS))

    def reset(self):
        self._write("reset\n")

    def stop(self):
        try:
            self._write("quit\n")
        except Exception:
            pass
        try:
            self.proc.terminate()
        except Exception:
            pass


SIMULATOR = Sim()


# --------------------------------------------------------------------- server

def content_type(path):
    if path.endswith(".html"):
        return "text/html; charset=utf-8"
    if path.endswith(".js"):
        return "application/javascript; charset=utf-8"
    if path.endswith(".css"):
        return "text/css; charset=utf-8"
    if path.endswith(".png"):
        return "image/png"
    if path.endswith(".json"):
        return "application/json"
    return "application/octet-stream"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # quiet

    def _send_file(self, base, rel):
        rel = posixpath.normpath("/" + rel).lstrip("/")
        full = os.path.join(base, rel)
        if not os.path.abspath(full).startswith(os.path.abspath(base)):
            self.send_error(403)
            return
        if os.path.isdir(full):
            full = os.path.join(full, "hp11c-rom.html")
        if not os.path.isfile(full):
            self.send_error(404, "not found: " + rel)
            return
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type(full))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        if path == "/events":
            self._serve_events()
        elif path == "/" or path == "/rom" or path == "/rom/":
            self._send_file(HERE, "hp11c-rom.html")
        elif path.startswith("/rom/"):
            self._send_file(HERE, path[len("/rom/"):])
        else:
            self._send_file(HP11C, path.lstrip("/"))

    def _serve_events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = SIMULATOR.subscribe()
        try:
            while True:
                try:
                    frame = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    continue
                payload = "data: " + json.dumps(frame) + "\n\n"
                self.wfile.write(payload.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            SIMULATOR.unsubscribe(q)

    def do_POST(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode() if length else ""
        if body:
            for k, v in parse_qs(body).items():
                qs.setdefault(k, v)

        if u.path == "/key":
            n = qs.get("n", [None])[0]
            if n is None:
                self.send_error(400, "missing n")
                return
            SIMULATOR.key(int(n))
        elif u.path == "/reset":
            SIMULATOR.reset()
        elif u.path == "/power":
            SIMULATOR.key(41)  # ON
        else:
            self.send_error(404)
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()


def main():
    if not os.path.exists(SIM):
        print("missing %s - run 'make' first" % SIM, file=sys.stderr)
        return 1
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("HP-11C ROM bridge: http://localhost:%d/  (Ctrl-C to stop)" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        SIMULATOR.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
