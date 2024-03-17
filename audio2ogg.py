import os
import subprocess
import concurrent.futures
import shutil

# constants for source and output directories
SRC_DIR = 'db'
OUT_DIR = 'ogg'

# audio extensions (no .ogg)
AUDIO_EXTENSIONS = ['.mp3', '.wav', '.aiff', '.flac', '.aac', '.wma', '.m4a', '.amr', '.3gp']

def convert_to_ogg(src_path, out_path):
    """Convert an audio file to .ogg using ffmpeg."""
    command = ['ffmpeg', '-i', src_path, '-y', '-acodec', 'libvorbis', out_path]
    print(f'CONVERT {src_path} to {out_path}...')
    with open(os.devnull, 'w') as devnull:
        subprocess.run(command, stdout=devnull, stderr=devnull, check=True)
    print(f'DONE    {src_path} to {out_path}')

with concurrent.futures.ThreadPoolExecutor() as executor:
    for root, dirs, files in os.walk(SRC_DIR):
        for file in files:
            # construct full file path
            src_path = os.path.join(root, file)
            # construct corresponding output path
            relative_path = os.path.relpath(src_path, SRC_DIR)
            out_path = os.path.join(OUT_DIR, relative_path)
            # create output directory if it doesn't exist
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            # check if the file has an audio extension
            _, ext = os.path.splitext(file)
            if ext.lower() in AUDIO_EXTENSIONS:
                # change the extension to .ogg
                out_path = os.path.splitext(out_path)[0] + '.ogg'
                # convert the file
                executor.submit(convert_to_ogg, src_path, out_path)
            else:
                # copy the file as is
                shutil.copy2(src_path, out_path)
