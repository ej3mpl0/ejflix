"""Writes the AltStore source (https://faq.altstore.io/developers/make-a-source) for one
built .ipa. Everything AltStore checks against the file (version, build, size,
entitlements, privacy strings) is read from the .ipa itself, never typed by hand.

    python3 scripts/altstore_source.py --ipa ejFlix-0.4.0-ios.ipa --tag v0.4.0 \
        --entitlements ios/ejFlix/ejFlix.entitlements --notes notes.md --out altstore-source.json
"""

import argparse
import datetime
import json
import os
import plistlib
import zipfile

REPO = "ej3mpl0/ejflix"
RAW = f"https://raw.githubusercontent.com/{REPO}/main/mobile"
TINT = "#E50914"

DESCRIPTION = (
    "Todas tus películas y series, en un solo lugar: tu servidor Jellyfin o Emby, "
    "addons de Stremio, Live TV (M3U, Xtream, EPG), perfiles con PIN, saltar intro "
    "y 12 temas, con Liquid Glass en iOS 26.\n\n"
    "All your films and shows in one place: your Jellyfin or Emby server, Stremio "
    "addons, Live TV (M3U, Xtream, EPG), PIN profiles, skip intro and 12 themes."
)


def app_info_plist(ipa: zipfile.ZipFile) -> dict:
    for name in ipa.namelist():
        parts = name.split("/")
        if len(parts) == 3 and parts[0] == "Payload" and parts[1].endswith(".app") and parts[2] == "Info.plist":
            return plistlib.loads(ipa.read(name))
    raise SystemExit("no Payload/*.app/Info.plist in the ipa")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ipa", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--entitlements", help="the .entitlements plist the app was built with")
    ap.add_argument("--notes", help="markdown file with the release notes")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    with zipfile.ZipFile(args.ipa) as ipa:
        info = app_info_plist(ipa)

    entitlements: list[str] = []
    if args.entitlements and os.path.exists(args.entitlements):
        with open(args.entitlements, "rb") as f:
            entitlements = sorted(plistlib.load(f).keys())

    # AltStore shows these to the user before installing and compares them with the app.
    privacy = {k: v for k, v in sorted(info.items()) if k.startswith("NS") and k.endswith("UsageDescription")}

    notes = ""
    if args.notes and os.path.exists(args.notes):
        with open(args.notes, encoding="utf-8") as f:
            notes = f.read().strip()

    bundle_id = info["CFBundleIdentifier"]
    version = info["CFBundleShortVersionString"]
    source = {
        "name": "ejFlix",
        "subtitle": "Todas tus películas y series, en un solo lugar",
        "description": DESCRIPTION,
        "iconURL": f"{RAW}/assets/icon.png",
        "website": f"https://github.com/{REPO}",
        "tintColor": TINT,
        "nsfw": False,
        "featuredApps": [bundle_id],
        "apps": [
            {
                "name": info.get("CFBundleDisplayName") or info.get("CFBundleName") or "ejFlix",
                "bundleIdentifier": bundle_id,
                "developerName": "ej3mpl0",
                "subtitle": "Tus películas y series, en un solo lugar",
                "localizedDescription": DESCRIPTION,
                "iconURL": f"{RAW}/assets/icon.png",
                "tintColor": TINT,
                "category": "entertainment",
                "versions": [
                    {
                        "version": version,
                        "buildVersion": info["CFBundleVersion"],
                        "date": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
                        "localizedDescription": notes or f"ejFlix {version}",
                        "downloadURL": f"https://github.com/{REPO}/releases/download/{args.tag}/{os.path.basename(args.ipa)}",
                        "size": os.path.getsize(args.ipa),
                        "minOSVersion": info.get("MinimumOSVersion", "16.4"),
                    }
                ],
                "appPermissions": {"entitlements": entitlements, "privacy": privacy},
            }
        ],
        "news": [],
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(source, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(source["apps"][0]["versions"][0], indent=2))
    print("privacy:", list(privacy), "entitlements:", entitlements)


if __name__ == "__main__":
    main()
