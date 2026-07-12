#!/usr/bin/env python3

import json
import os
import zipfile

DB_FILE = "db.json"
OUT_DIR = "out"
SOUND_EXTENSIONS = {
    ".ogg",
    ".mp3",
    ".wav",
    ".aiff",
    ".flac",
    ".aac",
    ".wma",
    ".m4a",
    ".amr",
    ".3gp",
}


def count_sounds(zip_path):
    count = 0
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            ext = os.path.splitext(name)[1].lower()
            if ext in SOUND_EXTENSIONS:
                count += 1
    return count


def main():
    with open(DB_FILE, "r", encoding="utf-8") as f:
        db = json.load(f)

    clickpacks = db["clickpacks"]
    updated = 0
    for name in clickpacks:
        zip_path = os.path.join(OUT_DIR, name + ".zip")
        if not os.path.exists(zip_path):
            print(f"WARN: archive not found for `{name}`, skipping")
            continue
        count = count_sounds(zip_path)
        clickpacks[name]["sound_count"] = count
        updated += 1

    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=4)

    print(f"Updated `sound_count` for {updated} clickpack(s) in `{DB_FILE}`")


if __name__ == "__main__":
    main()
