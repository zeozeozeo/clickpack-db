import os
import shutil
import math
import concurrent.futures
import json

SRC_DIR = "db"
DST_DIR = "out"
LARGE_FILESIZE = 25 * 1024 * 1024
NOISE_FILES = ["noise", "whitenoise", "pcnoise", "background"]
DB_FILENAME = "db.json"
DEBUG_DB = False
BASE_URL = "https://github.com/zeozeozeo/clickpack-db/raw/main/out/"
large_files = []

# load db.json if it exists
db = {}
if os.path.exists(os.path.join(DST_DIR, DB_FILENAME)):
    print(f"Loading `{DB_FILENAME}`...")
    with open(os.path.join(DST_DIR, DB_FILENAME)) as f:
        db = json.load(f)
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
        return "0B"
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
            return
        seen_sizes.append(initial_size)
        if has_noise:
            print(f"Clickpack `{dir_name}` has a noise file")
        shutil.make_archive(os.path.join(DST_DIR, dir_name), 'zip', dir_path)
        final_size = os.path.getsize(os.path.join(DST_DIR, dir_name + '.zip'))
        if final_size > LARGE_FILESIZE:
            large_files.append(dir_name)

        print(f"{dir_name}: {human_size(initial_size)} => {human_size(final_size)}, -{human_size(initial_size - final_size)}")
        db[dir_name] = {"size": final_size, "uncompressed_size": initial_size, "has_noise": has_noise, "url": BASE_URL + dir_name + '.zip'}

with concurrent.futures.ThreadPoolExecutor() as executor:
    executor.map(zip_dir, os.listdir(SRC_DIR))

print(f"\nFiles larger than {human_size(LARGE_FILESIZE)}:")
for file in large_files:
    print(file)
else:
    print("None!\n")

print(f"Removed {len(dups)} duplicates in total: {', '.join(dups)}")

actual_filename = DB_FILENAME
if DEBUG_DB:
    actual_filename = "debug_" + DB_FILENAME
with open(os.path.join(actual_filename), "w") as f:
    if DEBUG_DB:
        json.dump(db, f, indent=4)
    else:
        json.dump(db, f, separators=(',', ':'))
print(f"Final database consists of {len(db)} entries and is saved to `{actual_filename}`")
