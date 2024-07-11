import os
import shutil
import concurrent.futures
import json
from datetime import datetime, timezone
import argparse

parser = argparse.ArgumentParser(description='ClickpackDB Indexer')
parser.add_argument('--src', type=str, default='ogg', help='Source directory')
parser.add_argument('--dst', type=str, default='out', help='Destination directory')
parser.add_argument('--db', type=str, default='db.json', help='Database filename')
parser.add_argument('--debug', action='store_true', help='Enable debug mode')
parser.add_argument('--delete-duplicates', action='store_true', help='Delete duplicate clickpacks')
args = parser.parse_args()

SRC_DIR = args.src
DST_DIR = args.dst
NOISE_FILES = ["noise", "whitenoise", "pcnoise", "background"]
DB_FILENAME = args.db
DEBUG_DB = args.debug
BASE_URL = "https://github.com/zeozeozeo/clickpack-db/raw/main/out/"
DELETE_DUPLICATES = args.delete_duplicates
DEFAULT_DB = db = {'updated_at_iso': '', 'updated_at_unix': 0, 'version': 0, 'clickpacks': {}}

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

try:
    os.mkdir(DST_DIR)
except:
    pass

print(f"Source directory: {SRC_DIR}")
print(f"Destination directory: {DST_DIR}")

def get_info(path):
    total = 0
    has_noise = False
    for dirpath, _, filenames in os.walk(path):
        for ff in filenames:
            fp = os.path.join(dirpath, ff)
            # skip if it is symbolic link
            if not os.path.islink(fp):
                for n in NOISE_FILES:
                    if n in ff.lower():
                        has_noise = True
                total += os.path.getsize(fp)
    return total, has_noise

def human_size(num, suffix="B"):
    """https://stackoverflow.com/a/1094933"""
    for unit in ("", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei", "Zi"):
        if abs(num) < 1024.0:
            return f"{num:3.1f}{unit}{suffix}"
        num /= 1024.0
    return f"{num:.1f}Yi{suffix}"

dups = []

def zip_dir(dir_name):
    dir_path = os.path.join(SRC_DIR, dir_name)

    if os.path.isdir(dir_path):
        if dir_name in db['clickpacks']:
            print(f"WARN: Skipping `{dir_name}`: key already in database")
            return
        print(f"Zipping `{dir_name}`...")

        initial_size, has_noise = get_info(dir_path)

        # check if its a duplicate
        if initial_size in map(lambda v: v['uncompressed_size'], db['clickpacks'].values()):
            print(f"Found duplicate `{dir_name}` (size: {initial_size})")
            dups.append(dir_name)
            if DELETE_DUPLICATES:
                print(f"Deleting duplicate `{dir_name}` from `{SRC_DIR}`...")
                shutil.rmtree(dir_path)
            return

        if has_noise:
            print(f"Clickpack `{dir_name}` has a noise file")
        shutil.make_archive(os.path.join(DST_DIR, dir_name), 'zip', dir_path)
        final_size = os.path.getsize(os.path.join(DST_DIR, dir_name + '.zip'))

        print(f"{dir_name}: {human_size(initial_size)} => {human_size(final_size)}, -{human_size(initial_size - final_size)}")
        db['clickpacks'][dir_name] = {"size": final_size, "uncompressed_size": initial_size, "has_noise": has_noise, "url": BASE_URL + dir_name + '.zip'}

with concurrent.futures.ThreadPoolExecutor() as executor:
    executor.map(zip_dir, os.listdir(SRC_DIR))

print(f"\nRemoved {len(dups)} duplicates in total: {', '.join(dups)}")

# sort database alphabetically (case-insensitive)
db['clickpacks'] = {k: db['clickpacks'][k] for k in sorted(db['clickpacks'], key=str.lower)}

# set current time
now = datetime.now(timezone.utc)
db['updated_at_iso'] = now.isoformat()
db['updated_at_unix'] = int(round(now.timestamp()))
db['version'] += 1
print('Updated at: ' + db['updated_at_iso'])

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
