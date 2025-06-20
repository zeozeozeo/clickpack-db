#!/usr/bin/env python3

"""
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org/>
"""

import os
import shutil
import concurrent.futures
import json
from datetime import datetime, timezone
import argparse
import urllib.parse
from repro_zipfile import ReproducibleZipFile
import hashlib

parser = argparse.ArgumentParser(description='ClickpackDB Indexer')
parser.add_argument('--src', type=str, default='ogg', help='Source directory')
parser.add_argument('--dst', type=str, default='out', help='Destination directory')
parser.add_argument('--db', type=str, default='db.json', help='Database filename')
parser.add_argument('--debug', action='store_true', help='Enable debug mode')
parser.add_argument('--delete-duplicates', action='store_true', help='Delete duplicate clickpacks')
parser.add_argument('--hiatus-endpoint', type=str, default='https://hiatus.zeo.lol', help='Hiatus API endpoint')
parser.add_argument('--delete-dirs', action='store_true', help='Remove indexed folders in db directory and clear ogg directory')
args = parser.parse_args()

SRC_DIR = args.src
DST_DIR = args.dst
NOISE_FILES = ["noise", "whitenoise", "pcnoise", "background", "silence"]
DB_FILENAME = args.db
DEBUG_DB = args.debug
BASE_URL = "https://github.com/zeozeozeo/clickpack-db/raw/main/out/"
DELETE_DUPLICATES = args.delete_duplicates
HIATUS_ENDPOINT = args.hiatus_endpoint.strip('/')
DEFAULT_DB = db = {'updated_at_iso': '', 'updated_at_unix': 0, 'version': 0, 'clickpacks': {}, 'hiatus': HIATUS_ENDPOINT}
BUF_SIZE = 65536 # for checksums

# load db.json if it exists
db = {}
if os.path.exists(DB_FILENAME):
    print(f"Loading `{DB_FILENAME}`...")
    with open(DB_FILENAME, 'r', encoding='utf-8') as f:
        db = json.load(f)
for k, v in DEFAULT_DB.items():
    if k not in db:
        print(f'Adding default entry for key `{k}`: {v}')
        db[k] = v
print(f"Initial database consists of {len(db['clickpacks'])} entries")


for k in db['clickpacks']:
    # encode urls properly
    db['clickpacks'][k]['url'] = BASE_URL + urllib.parse.quote(k) + '.zip'

try:
    os.mkdir(DST_DIR)
except:
    pass

print(f"Source directory: {SRC_DIR}")
print(f"Destination directory: {DST_DIR}")

def get_info(path) -> tuple[int, bool, str]:
    total = 0
    has_noise = False
    readme = ""
    for dirpath, _, filenames in os.walk(path):
        for ff in filenames:
            fp = os.path.join(dirpath, ff)
            # skip if it is symbolic link
            if not os.path.islink(fp):
                # is it a noise file?
                for n in NOISE_FILES:
                    if n in ff.lower():
                        has_noise = True
                
                # is it a readme?
                if readme == "" and ff.endswith(".txt"):
                    print(f"Found readme {ff}")
                    with open(fp, "r", encoding="utf-8") as file:
                        readme = file.read()

                total += os.path.getsize(fp)
    return total, has_noise, readme

def human_size(num, suffix="B"):
    """https://stackoverflow.com/a/1094933"""
    for unit in ("", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei", "Zi"):
        if abs(num) < 1024.0:
            return f"{num:3.1f}{unit}{suffix}"
        num /= 1024.0
    return f"{num:.1f}Yi{suffix}"

dups = []
zips = [] # [(dir_name, zip_path)]

def zip_dir(dir_name):
    dir_path = os.path.join(SRC_DIR, dir_name)

    if os.path.isdir(dir_path):
        if dir_name in db['clickpacks']:
            print(f"WARN: Skipping `{dir_name}`: key already in database")
            return
        print(f"Zipping `{dir_name}`...")

        initial_size, has_noise, readme = get_info(dir_path)

        if initial_size in map(lambda v: v['uncompressed_size'], db['clickpacks'].values()):
            print(f"Found duplicate `{dir_name}` (size: {initial_size})")
            dups.append(dir_name)
            if DELETE_DUPLICATES:
                print(f"Deleting duplicate `{dir_name}` from `{SRC_DIR}`...")
                shutil.rmtree(dir_path)
            return

        if has_noise:
            print(f"Clickpack `{dir_name}` has a noise file")

        zip_path = os.path.join(DST_DIR, dir_name + '.zip')
        with ReproducibleZipFile(zip_path, 'w') as zf:
            for root, _, files in os.walk(dir_path):
                for file in sorted(files):
                    full_path = os.path.join(root, file)
                    arcname = os.path.relpath(full_path, dir_path)
                    zf.write(full_path, arcname=arcname)
        zips.append((dir_name, zip_path))

        final_size = os.path.getsize(zip_path)
        print(f"{dir_name}: {human_size(initial_size)} => {human_size(final_size)}, -{human_size(initial_size - final_size)}")
        
        now = datetime.now(timezone.utc)
        entry = {
            "size": final_size,
            "uncompressed_size": initial_size,
            "has_noise": has_noise,
            "url": BASE_URL + urllib.parse.quote(dir_name) + '.zip',
            "added_at": now.isoformat()
        }

        if readme != "":
            print(f"Clickpack `{dir_name}` has a readme: {readme}")
            entry["readme"] = readme
        db['clickpacks'][dir_name] = entry

with concurrent.futures.ThreadPoolExecutor() as executor:
    executor.map(zip_dir, os.listdir(SRC_DIR))

print(f"\nRemoved {len(dups)} duplicates in total: {', '.join(dups)}")

for i, (dir_name, zip_path) in enumerate(zips):
    print(f'({i+1}/{len(zips)}) Calculating checksums...', end='\r')
    md5 = hashlib.md5()
    with open(zip_path, 'rb') as f:
        while True:
            data = f.read(BUF_SIZE)
            if not data:
                break
            md5.update(data)
    db['clickpacks'][dir_name]['checksum'] = md5.hexdigest()

print()

# sort database alphabetically (case-insensitive)
db['clickpacks'] = {k: db['clickpacks'][k] for k in sorted(db['clickpacks'], key=str.lower)}

# only update timestamp and version if new clickpacks were added
if len(zips) > 0:
    # set current time
    now = datetime.now(timezone.utc)
    db['updated_at_iso'] = now.isoformat()
    db['updated_at_unix'] = int(round(now.timestamp()))
    db['version'] += 1
    print('Updated at: ' + db['updated_at_iso'])
    print(f"Added {len(zips)} new clickpack(s), incremented version to {db['version']}")
else:
    print("No new clickpacks were added, keeping existing timestamp and version")

db['hiatus'] = HIATUS_ENDPOINT

actual_filename = DB_FILENAME
if DEBUG_DB:
    actual_filename = "debug_" + DB_FILENAME
with open(os.path.join(actual_filename), "w", encoding="utf-8") as f:
    if DEBUG_DB:
        json.dump(db, f, indent=4)
    else:
        json.dump(db, f, separators=(',', ':'))
print(f"Final database consists of {len(db['clickpacks'])} entries and is saved to `{actual_filename}`")
total_size = sum(map(lambda x: x["size"], db['clickpacks'].values()))
total_uncomp_size = sum(map(lambda x: x["uncompressed_size"], db['clickpacks'].values()))
print(f"Total database size (compressed): {human_size(total_size)}")
print(f"Total database size (uncompressed): {human_size(total_uncomp_size)}")

if args.delete_dirs:
    print("\n" + "="*50)
    print("Delete directories mode enabled - cleaning up after indexing")
    
    # Clear ogg directory
    if os.path.exists(SRC_DIR):
        print(f"Clearing contents of {SRC_DIR} directory...")
        for item in os.listdir(SRC_DIR):
            item_path = os.path.join(SRC_DIR, item)
            if os.path.isdir(item_path):
                print(f"Removing directory: {item}")
                shutil.rmtree(item_path)
            elif os.path.isfile(item_path):
                print(f"Removing file: {item}")
                os.remove(item_path)
        print(f"Cleared {SRC_DIR} directory")
    else:
        print(f"Source directory {SRC_DIR} does not exist")
    
    # Clear db directory
    db_dir = "db"
    if os.path.exists(db_dir):
        print(f"Clearing contents of {db_dir} directory...")
        for item in os.listdir(db_dir):
            item_path = os.path.join(db_dir, item)
            if os.path.isdir(item_path):
                print(f"Removing directory: {item}")
                shutil.rmtree(item_path)
            elif os.path.isfile(item_path) and item != "put_clickpacks_here":
                print(f"Removing file: {item}")
                os.remove(item_path)
        print(f"Cleared {db_dir} directory")
    else:
        print(f"DB directory {db_dir} does not exist")
    
    print("Directory cleanup complete after indexing")
