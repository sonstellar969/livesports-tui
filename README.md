# livesports-tui

https://github.com/user-attachments/assets/c4ffa459-6f22-4461-9df1-f92a9df6481e



A terminal UI for browsing live and upcoming Fancode / SonyLiv matches and playing them directly with `mpv` or `VLC` — no browser, no Stremio.

- Split-pane TUI: match list on the left, poster + details on the right
- Live matches sorted first, upcoming matches sorted by start time
- Pick your player (`mpv` or `VLC`) per stream, tuned with a bigger read-ahead buffer and auto-reconnect so live playback doesn't stutter on network hiccups
- Poster preview rendered as ANSI block art directly inside the TUI

## Requirements

- [Node.js](https://nodejs.org/) 22 or newer
- One of:
  - [`mpv`](https://mpv.io/) (recommended — handles this content more reliably)
  - [VLC](https://www.videolan.org/vlc/)

## Install

### macOS

```bash
# Node.js (if you don't have it)
brew install node

# a player
brew install mpv
# or
brew install --cask vlc

# the app
git clone https://github.com/sonstellar969/livesports-tui.git
cd livesports-tui
npm install
```

### Linux (Debian/Ubuntu)

```bash
# Node.js (if you don't have it)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# a player
sudo apt install -y mpv
# or
sudo apt install -y vlc

# the app
git clone https://github.com/sonstellar969/livesports-tui.git
cd livesports-tui
npm install
```

### Linux (Arch)

```bash
sudo pacman -S nodejs npm mpv
# or: sudo pacman -S vlc

git clone https://github.com/sonstellar969/livesports-tui.git
cd livesports-tui
npm install
```

### Windows

```powershell
# Node.js (if you don't have it) - https://nodejs.org/en/download
winget install OpenJS.NodeJS.LTS

# a player
winget install mpv.net
# or
winget install VideoLAN.VLC

git clone https://github.com/sonstellar969/livesports-tui.git
cd livesports-tui
npm install
```

> On Windows, make sure `mpv` (or `vlc`) is on your `PATH` — `mpv.net`'s installer usually handles this; for plain `mpv`, add its install folder to `PATH` manually.

## Run

```bash
node index.js
```

or, after `npm install`, if you want a global `livesports-tui` command:

```bash
npm link
livesports-tui
```

## Controls

| Key | Action |
|---|---|
| `↑` / `↓` | Move selection |
| `Enter` | Choose a match → choose a player (mpv/VLC) → play |
| `r` | Refresh the match list |
| `q` / `Esc` | Quit |

## How it works

Fetches live/upcoming event data from the community-maintained [`fancode-live-events`](https://github.com/drmlive/fancode-live-events) and [`sliv-live-events`](https://github.com/drmlive/sliv-live-events) feeds, then hands the stream URL straight to your own `mpv`/`VLC` installation — playback happens entirely on your machine, over your own network connection.

## About the poster image quality

The poster is drawn as ANSI block art (colored terminal characters), not a true photo — this is intentional, not a bug. Terminals like iTerm2 and Kitty support real inline image protocols, but this app is built with [Ink](https://github.com/vadimdemedes/ink) (a React renderer for the terminal), and Ink's own text layout/wrapping corrupts those native image escape sequences — in testing, they rendered as nothing at all in iTerm2. Forcing ANSI block rendering everywhere is the trade-off that reliably shows *something* in every terminal, rather than sometimes showing nothing.

If you want the poster bigger/clearer within that constraint, widen your terminal window — the render width scales with the detail pane's width.

## Notes

- Fancode's CDN blocks requests from datacenter/cloud IPs — this is why streams are played directly from your own machine/network, never proxied through a server.
- If a stream doesn't start, the live event may have just ended or not started yet — press `r` to refresh the list.
- Standalone `mpv`/VLC handle Fancode's live HLS streams correctly; Stremio's bundled player does not (a separate, unrelated bug in Stremio's own mpv build) — this tool exists specifically to sidestep that.

## Credits

- [drmlive/fancode-live-events](https://github.com/drmlive/fancode-live-events) and [drmlive/sliv-live-events](https://github.com/drmlive/sliv-live-events) — the community-maintained live event feeds this tool is built on
- [Ink](https://github.com/vadimdemedes/ink) — React for CLIs, powers the split-pane TUI
- [terminal-image](https://github.com/sindresorhus/terminal-image) — poster rendering
- [mpv](https://mpv.io/) / [VLC](https://www.videolan.org/vlc/) — actual playback

## License

[MIT](LICENSE)
