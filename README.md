# ejFlix

A lightweight Jellyfin client for Windows 11. Netflix-style browsing and native Direct Play through mpv: 4K, HDR, and the original codec, without transcoding.

The interface is available in **Spanish** and **English**. Use the ES / EN control in the title bar.

![Home](docs/screenshots/home.png)

## Screenshots

| Connect | Profiles |
| --- | --- |
| ![Login](docs/screenshots/login.png) | ![Profiles](docs/screenshots/profiles.png) |

| Home | Player |
| --- | --- |
| ![Home](docs/screenshots/home.png) | ![Player](docs/screenshots/player.png) |

## Features

- Connect with the Jellyfin server URL only, then pick a profile
- Saved server, profiles, and session (the access token is encrypted with Windows DPAPI)
- Home with hero, continue watching, recently added, and genre rows
- Movie details, ratings, resume or start over
- Overlay player controls on top of the mpv video window
- Language selector: Spanish and English
- Native playback: Direct Play, hardware decode, HDR when Windows HDR is on

## Requirements

- Windows 11
- A reachable Jellyfin server
- [mpv](https://mpv.io/) for local builds (`C:\mpv\mpv.exe` or `src-tauri/resources/mpv.exe`)

To develop from source you also need:

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) with the MSVC toolchain
- Visual Studio Build Tools or Community with C++

## Install

Use the NSIS installer from [Releases](../../releases) (`ejFlix_*_x64-setup.exe`). It installs per-user and does not require admin.

After install, enter your Jellyfin URL (for example `http://192.168.1.10:8096`) and sign in.

## Development

```bash
npm install
npm run prepare-mpv
npm run tauri dev
```

If the repo lives on a network drive, set `CARGO_TARGET_DIR` to a local folder before compiling.

## Build the installer

```bash
npm run prepare-mpv
npm run tauri build
```

The NSIS package is written to `src-tauri/target/release/bundle/nsis/` (or `$CARGO_TARGET_DIR/release/bundle/nsis/`).

Do not commit `mpv.exe`, `release/`, or `session.json`. Those paths are in `.gitignore`.

## Language

The ES / EN control is on the login, profile, and home screens. The choice is stored with the app data and restored on the next launch. If nothing is saved yet, the app follows the Windows UI language (`en*` to English, otherwise Spanish).

## Player shortcuts

| Key | Action |
| --- | --- |
| Space / K | Play / pause |
| Left / Right | Seek 10 seconds |
| Up / Down | Volume |
| M | Mute |
| F | Fullscreen |
| Esc | Exit player |

## Security notes

- Passwords are not stored. Only the Jellyfin access token is kept, encrypted for the current Windows user.
- Image and stream URLs do not include `api_key`. Authenticated images go through a local protocol; mpv sends the token as a header.
- HTTPS certificates are validated on the public internet. Self-signed certificates are accepted only for localhost and private LAN addresses.
- The WebView cannot read the session store directly.

## License

Use and modify for your own Jellyfin server. Bundled mpv is subject to its own license.
