import os
import subprocess
import concurrent.futures
import shutil
import zipfile

# constants for source and output directories
SRC_DIR = 'db'
OUT_DIR = 'ogg'

# audio extensions (no .ogg)
AUDIO_EXTENSIONS = ['.mp3', '.wav', '.aiff', '.flac', '.aac', '.wma', '.m4a', '.amr', '.3gp']
ARCHIVE_EXTENSIONS = ['.zip', '.rar']

def convert_to_ogg(src_path, out_path):
    """Convert an audio file to .ogg using ffmpeg."""
    command = ['ffmpeg', '-i', src_path, '-y', '-flags', 'bitexact', '-acodec', 'libvorbis', out_path]
    print(f'CONVERT {src_path} to {out_path}...')
    with open(os.devnull, 'wb') as devnull:
        subprocess.run(command, stdout=devnull, stderr=devnull, check=True)
    print(f'DONE    {src_path} to {out_path}')

def process_directory(src_dir, out_dir):
    with concurrent.futures.ThreadPoolExecutor() as executor:
        for root, _, files in os.walk(src_dir):
            for file in files:
                # construct full file path
                src_path = os.path.join(root, file)
                # construct corresponding output path
                relative_path = os.path.relpath(src_path, src_dir)
                out_path = os.path.join(out_dir, relative_path)
                # create output directory if it doesn't exist
                os.makedirs(os.path.dirname(out_path), exist_ok=True)
                # check if the file has an audio extension
                _, ext = os.path.splitext(file)
                if ext.lower() in AUDIO_EXTENSIONS:
                    # change the extension to .ogg
                    out_path = os.path.splitext(out_path)[0] + '.ogg'
                    if os.path.exists(out_path):
                        print(f'SKIP    {src_path} to {out_path}...')
                        continue
                    # convert the file
                    executor.submit(convert_to_ogg, src_path, out_path)
                else:
                    # copy the file as is
                    shutil.copy2(src_path, out_path)

def unzip_files(src_dir):
    print(f'UNZIPPING files in {src_dir}...')
    for file in os.listdir(src_dir):
        file_path = os.path.join(src_dir, file)
        if not os.path.isfile(file_path):
            continue

        print(f'UNZIPPING {file_path}...')

        if zipfile.is_zipfile(file_path):
            with zipfile.ZipFile(file_path) as zf:
                # check if the archive has a root directory
                root_dirs = [f for f in zf.namelist() if f.endswith('/')]
                if len(root_dirs) == 1:
                    # extract the root directory but rename it into the name of the archive
                    root_dir = root_dirs[0]
                    new_root_dir = os.path.splitext(file)[0]
                    zf.extractall(src_dir, pwd=None)
                    shutil.move(os.path.join(src_dir, root_dir), os.path.join(src_dir, new_root_dir))
                    shutil.rmtree(os.path.join(src_dir, root_dir))
                else:
                    # create the directory with the name of the archive and unzip it into that directory
                    new_root_dir = os.path.splitext(file)[0]
                    os.makedirs(os.path.join(src_dir, new_root_dir), exist_ok=True)
                    zf.extractall(os.path.join(src_dir, new_root_dir), pwd=None)

        print(f'DONE {file}')

if __name__ == '__main__':
    #unzip_files(SRC_DIR)
    process_directory(SRC_DIR, OUT_DIR)
