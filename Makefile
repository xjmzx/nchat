PREFIX  ?= $(HOME)/.local
BINDIR  ?= $(PREFIX)/bin
APPDIR  ?= $(PREFIX)/share/applications
ICONDIR ?= $(PREFIX)/share/icons/hicolor/scalable/apps

DESKTOP_OUT := $(APPDIR)/nchat.desktop
TAURI_BIN   := src-tauri/target/release/nchat

.PHONY: help deps dev build install uninstall check test clean icons

help:
	@echo "Targets:"
	@echo "  make deps       npm install + cargo fetch (one-time setup)"
	@echo "  make dev        run 'tauri dev' (hot-reload)"
	@echo "  make build      release build of frontend + Rust binary"
	@echo "  make install    copy binary + desktop entry under PREFIX  [Linux]"
	@echo "                  (default PREFIX=\$$HOME/.local; sudo PREFIX=/usr/local for system-wide)"
	@echo "  ./install.sh    build a .app and install it to /Applications  [macOS]"
	@echo "  make uninstall  remove what 'install' put down"
	@echo "  make check      typecheck + cargo check (no build)"
	@echo "  make test       cargo test (gift-wrap round trip + whitelist rules)"
	@echo "  make clean      remove dist/ and src-tauri/target/"

deps:
	npm install
	cd src-tauri && cargo fetch

dev:
	npm run tauri dev

# Regenerate the Tauri bundle icon set from icon.svg (run once per icon change).
icons:
	@if command -v rsvg-convert >/dev/null 2>&1; then \
		rsvg-convert -w 1024 -h 1024 icon.svg -o app-icon.png; \
	elif command -v convert >/dev/null 2>&1; then \
		convert -background none -resize 1024x1024 icon.svg app-icon.png; \
	else \
		echo "need rsvg-convert (librsvg2-bin) or imagemagick"; exit 1; \
	fi
	npm run tauri icon ./app-icon.png
	rm -f app-icon.png

build: $(TAURI_BIN)

$(TAURI_BIN): $(shell find src src-tauri/src -type f) package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
	npm run tauri build -- --no-bundle

check:
	npm run build
	cd src-tauri && cargo check

test:
	cd src-tauri && cargo test --lib

# Linux layout: a bare binary plus a .desktop entry. On macOS this would put an
# unbundled binary in ~/.local/bin — no Info.plist, no icon, and no bundle
# identifier, which the Keychain uses to decide who may read an entry. Since
# every secret this app holds lives in that store, a bundle-less install is not
# a lesser install, it is a different app to the OS. Use ./install.sh there.
install: $(TAURI_BIN)
	@if [ "$$(uname)" = "Darwin" ]; then \
		echo "'make install' is the Linux layout (bare binary + .desktop)."; \
		echo "On macOS run ./install.sh — it builds a .app and installs it to /Applications."; \
		exit 1; \
	fi
	install -d $(BINDIR) $(APPDIR) $(ICONDIR)
	install -m 0755 $(TAURI_BIN) $(BINDIR)/nchat
	install -m 0644 icon.svg $(ICONDIR)/nchat.svg
	sed -e 's|@BINDIR@|$(BINDIR)|g' \
	    -e 's|@ICONDIR@|$(ICONDIR)|g' \
	    nchat.desktop.in > $(DESKTOP_OUT)
	chmod 0644 $(DESKTOP_OUT)
	@if command -v update-desktop-database >/dev/null 2>&1; then \
		update-desktop-database $(APPDIR) >/dev/null 2>&1 || true; \
	fi
	@if command -v gtk-update-icon-cache >/dev/null 2>&1; then \
		gtk-update-icon-cache -f -t $(PREFIX)/share/icons/hicolor >/dev/null 2>&1 || true; \
	fi
	@echo "installed to $(PREFIX)"
	@echo "  binary  -> $(BINDIR)/nchat"
	@echo "  desktop -> $(DESKTOP_OUT)"

uninstall:
	rm -f $(BINDIR)/nchat
	rm -f $(ICONDIR)/nchat.svg
	rm -f $(DESKTOP_OUT)
	@if command -v update-desktop-database >/dev/null 2>&1; then \
		update-desktop-database $(APPDIR) >/dev/null 2>&1 || true; \
	fi
	@echo "uninstalled from $(PREFIX)"

clean:
	rm -rf dist src-tauri/target
