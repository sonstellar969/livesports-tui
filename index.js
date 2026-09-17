#!/usr/bin/env node
/**
 * livesports-tui
 * Description: Terminal UI for live/upcoming Fancode and SonyLiv streams, playable via mpv/VLC
 * License: MIT
 */
import React, { useEffect, useState, useCallback } from 'react';
import { render, Box, Text, useApp, useInput, useStdout } from 'ink';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import terminalImage from 'terminal-image';

const h = React.createElement;

const FANCODE_EVENTS_URL = 'https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json';
const SONYLIV_EVENTS_URL = 'https://raw.githubusercontent.com/drmlive/sliv-live-events/main/sonyliv.json';

function resolveVlcPath() {
  if (process.platform === 'darwin') {
    return '/Applications/VLC.app/Contents/MacOS/VLC';
  }

  if (process.platform === 'win32') {
    const windowsPaths = [
      process.env.ProgramW6432,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA &&
        path.join(process.env.LOCALAPPDATA, 'Programs'),
    ]
      .filter(Boolean)
      .map((basePath) =>
        path.join(basePath, 'VideoLAN', 'VLC', 'vlc.exe')
      );

    const installedPath = windowsPaths.find((candidate) =>
      fs.existsSync(candidate)
    );

    if (installedPath) return installedPath;
  }

  return 'vlc';
}

const VLC_PATH = resolveVlcPath();

const PLAYERS = [
  {
    key: 'mpv',
    label: 'mpv',
    bin: 'mpv',
    // mpv's default cache margin against the HLS live edge is thin (often
    // under 1s), so brief server/CDN jitter can empty it and trigger a
    // visible rebuffer even on a fast connection - confirmed directly via
    // mpv's own paused-for-cache/demuxer-cache-duration IPC properties.
    // --demuxer-readahead-secs/--demuxer-max-bytes just widen that cushion
    // (verified over 40s+ of real playback on both a cricket and a MotoGP
    // stream: cache builds to 8-15s, no stalls). This is NOT the same as the
    // --stream-lavf-o=reconnect=1 / --loop-file=inf combo from an earlier
    // attempt, which actively broke playback - HLS live playback works by
    // mpv repeatedly re-fetching a small, complete .m3u8 file, and each
    // fetch naturally hits EOF when done (normal, not a dropped connection).
    // reconnect=1 made ffmpeg treat every one of those routine completions
    // as an error and retry/give up ("Will reconnect ... error=End of file"
    // / "Failed to reload playlist" in the logs), and loop-file=inf tried to
    // restart the stream from the beginning on every one of those same EOF
    // events - together causing the stop-after-~10s crash. Neither of those
    // two flags are used here.
    args: ['--cache=yes', '--demuxer-max-bytes=60MiB', '--demuxer-readahead-secs=15', '--demuxer-lavf-o=protocol_whitelist="file,http,https,tcp,tls,crypto"'],
  },
  {
    key: 'vlc',
    label: 'VLC',
    bin: VLC_PATH,
    // VLC's default network cache (1s) is too tight for live HLS jitter.
    args: ['--network-caching=4000'],
  },
];

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    return [];
  }
}

function parseFancodeTime(str) {
  if (!str) return 0;
  const match = str.match(/(\d{2}):(\d{2}):(\d{2})\s(AM|PM)\s(\d{2})-(\d{2})-(\d{4})/i);
  if (!match) return 0;
  let [, hh, mm, ss, ampm, DD, MM, YYYY] = match;
  hh = parseInt(hh, 10);
  if (ampm.toUpperCase() === 'PM' && hh < 12) hh += 12;
  if (ampm.toUpperCase() === 'AM' && hh === 12) hh = 0;
  return new Date(`${YYYY}-${MM}-${DD}T${String(hh).padStart(2, '0')}:${mm}:${ss}+05:30`).getTime();
}

async function loadMatches() {
  const [fancode, sonyliv] = await Promise.all([
    fetchJson(FANCODE_EVENTS_URL),
    fetchJson(SONYLIV_EVENTS_URL),
  ]);

  const matches = [];

  for (const m of fancode) {
    const streamUrl = m.dai_url || m.adfree_url || null;
    if (!streamUrl) continue;

    matches.push({
      id: `fancode:${m.match_id}`,
      provider: 'Fancode',
      isLive: m.status === 'LIVE',
      title: m.match_name || m.title || 'Fancode Event',
      team1: m.team_1,
      team2: m.team_2,
      competition: m.event_name || m.event_category || 'Unknown',
      startTime: m.startTime || null,
      startTimeMs: parseFancodeTime(m.startTime),
      language: m.audioLanguageName || null,
      poster: m.src,
      streamUrl,
      userAgent: m['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
  }

  for (const m of sonyliv) {
    const streamUrl = m.video_url || m.dai_url || null;
    matches.push({
      id: `sonyliv:${m.contentId}`,
      provider: 'SonyLiv',
      isLive: m.isLive === true,
      title: m.match_name || m.event_name || 'SonyLiv Event',
      team1: null,
      team2: null,
      competition: m.event_name || m.event_category || 'Unknown',
      startTime: null,
      startTimeMs: 0,
      language: m.audioLanguageName || null,
      poster: m.src,
      streamUrl,
      userAgent: m['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
  }

  matches.sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return a.startTimeMs - b.startTimeMs;
  });

  return matches;
}

function playStream(url, playerBin, playerArgs, userAgent, onExit) {
  const args = [...playerArgs];
  if (userAgent) {
    if (playerBin.includes('mpv')) {
      args.push(`--user-agent=${userAgent}`);
    } else if (playerBin.toLowerCase().includes('vlc')) {
      args.push(`--http-user-agent=${userAgent}`);
    }
  }
  const player = spawn(playerBin, [...args, url], { stdio: 'inherit' });
  player.on('error', (err) => {
    console.error(`Could not launch "${playerBin}": ${err.message}`);
    onExit(1);
  });
  player.on('exit', (code) => onExit(code ?? 0));
}

const imageCache = new Map();

async function renderPoster(url, widthCols, heightRows) {
  if (!url) return null;
  const cacheKey = `${url}:${widthCols}x${heightRows}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    // Giving BOTH width and height (in terminal columns/rows) with
    // preserveAspectRatio makes it "contain" within that box instead of
    // overflowing - passing only width let the auto-computed height blow
    // way past our pane and spill into the rest of the UI.
    // preferNativeRender:false forces the plain ANSI block-art renderer even
    // in terminals that support real inline images (iTerm2/Kitty) - Ink's
    // own text layout/wrapping corrupts those native image escape sequences
    // (they rendered as nothing at all in iTerm2), so ANSI blocks are the
    // only mode that reliably works inside an Ink-rendered UI.
    const rendered = await terminalImage.buffer(buffer, {
      width: widthCols,
      height: heightRows,
      preserveAspectRatio: true,
      preferNativeRender: false,
    });
    imageCache.set(cacheKey, rendered);
    return rendered;
  } catch {
    return null;
  }
}

function MatchRow({ match, selected }) {
  const label = `${match.provider} · ${match.title}`;
  return h(
    Box,
    null,
    h(
      Text,
      { inverse: selected, wrap: 'truncate-end' },
      h(Text, { color: match.isLive ? 'red' : 'yellow' }, match.isLive ? '● ' : '◷ '),
      label
    )
  );
}

const IMAGE_HEIGHT_ROWS = 14;

function DetailPane({ match, imageWidthCols }) {
  const [poster, setPoster] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!match) return undefined;
    setPoster(null);
    setLoading(true);
    renderPoster(match.poster, imageWidthCols, IMAGE_HEIGHT_ROWS).then((rendered) => {
      if (!cancelled) {
        setPoster(rendered);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [match && match.id, imageWidthCols]);

  if (!match) {
    return h(Text, { dimColor: true }, 'No match selected');
  }

  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Box,
      { marginBottom: 1, height: IMAGE_HEIGHT_ROWS + 1, overflow: 'hidden' },
      loading
        ? h(Text, { dimColor: true }, 'Loading poster...')
        : poster
          ? h(Text, null, poster)
          : h(Text, { dimColor: true }, '(no poster)')
    ),
    match.team1 && match.team2
      ? h(Text, { bold: true }, `${match.team1}  vs  ${match.team2}`)
      : h(Text, { bold: true }, match.title),
    h(Text, { color: match.isLive ? 'red' : 'yellow' }, match.isLive ? '● LIVE NOW' : `◷ UPCOMING${match.startTime ? ` · ${match.startTime}` : ''}`),
    h(Text, { dimColor: true }, match.competition),
    h(Text, null, `Provider: ${match.provider}`),
    match.language ? h(Text, null, `Language: ${match.language}`) : null,
    h(Text, null, ' '),
    match.streamUrl
      ? h(Text, { dimColor: true }, 'Press Enter to choose a player and play')
      : h(Text, { color: 'yellow' }, 'Stream not yet available')
  );
}

function PlayerPicker({ match, playerIndex }) {
  return h(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: 'magenta', paddingX: 1, marginTop: 1 },
    h(Text, { bold: true }, `Play "${match.title}" with:`),
    ...PLAYERS.map((p, i) =>
      h(Text, { key: p.key, inverse: i === playerIndex }, `${i === playerIndex ? '❯ ' : '  '}${p.label}`)
    ),
    h(Text, { dimColor: true }, '↑/↓ choose  ·  Enter confirm  ·  Esc back')
  );
}

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('loading');
  const [index, setIndex] = useState(0);
  const [choosingPlayer, setChoosingPlayer] = useState(false);
  const [playerIndex, setPlayerIndex] = useState(0);
  const [launching, setLaunching] = useState(null);

  const refresh = useCallback(() => {
    setStatus('loading');
    loadMatches().then((m) => {
      setMatches(m);
      setStatus(m.length ? 'ready' : 'empty');
      setIndex(0);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInput((input, key) => {
    if (launching) return;

    if (choosingPlayer) {
      if (key.upArrow) setPlayerIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setPlayerIndex((i) => Math.min(PLAYERS.length - 1, i + 1));
      if (key.escape) setChoosingPlayer(false);
      if (key.return) {
        const match = matches[index];
        const player = PLAYERS[playerIndex];
        setLaunching({ match, player });
        // Spawn directly here instead of via a useEffect keyed on `launching`:
        // exit() unmounts the Ink tree synchronously, which can tear the
        // component down before a pending effect ever gets to run - so the
        // player would silently never launch. Restore the terminal first
        // (bracketed paste / raw mode), then spawn.
        exit();
        process.stdout.write('\x1b[?2004l');
        playStream(match.streamUrl, player.bin, player.args, match.userAgent, (code) => process.exit(code));
      }
      return;
    }

    if (status !== 'ready') return;
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setIndex((i) => Math.min(matches.length - 1, i + 1));
    if (input === 'r') refresh();
    if (input === 'q' || key.escape) exit();
    if (key.return && matches[index] && matches[index].streamUrl) {
      setPlayerIndex(0);
      setChoosingPlayer(true);
    }
  });

  if (launching) {
    return h(Text, null, `Launching ${launching.player.label} for: ${launching.match.title}...`);
  }

  if (status === 'loading') {
    return h(Text, null, 'Fetching live streams from Fancode and SonyLiv...');
  }

  if (status === 'empty') {
    return h(Text, { color: 'yellow' }, 'No playable matches found right now. Press r to retry, q to quit.');
  }

  const termWidth = stdout && stdout.columns ? stdout.columns : 100;
  const listWidth = Math.max(30, Math.floor(termWidth * 0.45));
  const detailWidth = Math.max(30, termWidth - listWidth - 6);
  const imageWidthCols = Math.max(16, detailWidth - 4);
  const selectedMatch = matches[index];

  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Box,
      { flexDirection: 'row' },
      h(
        Box,
        { flexDirection: 'column', width: listWidth, borderStyle: 'round', borderColor: 'cyan', paddingX: 1 },
        h(Text, { bold: true, underline: true }, 'Live / Upcoming'),
        ...matches.map((m, i) => h(MatchRow, { key: m.id, match: m, selected: i === index }))
      ),
      h(
        Box,
        { flexDirection: 'column', width: detailWidth, borderStyle: 'round', borderColor: 'green', paddingX: 1, marginLeft: 1 },
        h(DetailPane, { match: selectedMatch, imageWidthCols })
      )
    ),
    choosingPlayer ? h(PlayerPicker, { match: selectedMatch, playerIndex }) : null,
    h(Text, { dimColor: true }, '↑/↓ navigate  ·  Enter play  ·  r refresh  ·  q quit')
  );
}

render(h(App));
