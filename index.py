import os
import shutil
import math
import concurrent.futures
import json
from datetime import datetime, timezone

SRC_DIR = "ogg"
DST_DIR = "out"
NOISE_FILES = ["noise", "whitenoise", "pcnoise", "background"]
DB_FILENAME = "db.json"
DEBUG_DB = False
BASE_URL = "https://github.com/zeozeozeo/clickpack-db/raw/main/out/"
DELETE_DUPLICATES = True
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
print(f"Initial database consists of {len(db)} entries")

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
        for f in filenames:
            for noise_name in NOISE_FILES:
                if f.lower().startswith(noise_name):
                    has_noise = True
            fp = os.path.join(dirpath, f)
            total += os.path.getsize(fp)
    return total, has_noise

def human_size(size_bytes):
    if size_bytes == 0:
        return "0 B"
    size_name = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    i = int(math.floor(math.log(size_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {size_name[i]}"

seen_sizes = []
dups = []

def zip_dir(dir_name):
    dir_path = os.path.join(SRC_DIR, dir_name)

    if os.path.isdir(dir_path):
        print(f"Zipping `{dir_name}`...")

        initial_size, has_noise = get_info(dir_path)
        if initial_size in seen_sizes:
            print(f"Found duplicate `{dir_name}`")
            dups.append(dir_name)
            if DELETE_DUPLICATES:
                print(f"Deleting duplicate `{dir_name}` from `{SRC_DIR}`...")
                shutil.rmtree(dir_path)
            return
        seen_sizes.append(initial_size)
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
