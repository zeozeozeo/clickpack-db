#!/usr/bin/env python3

import os
import subprocess
import concurrent.futures
import shutil
import zipfile
import rarfile
import py7zr

# constants for source and output directories
SRC_DIR = 'db'
OUT_DIR = 'ogg'

# audio extensions (no .ogg)
AUDIO_EXTENSIONS = ['.mp3', '.wav', '.aiff', '.flac', '.aac', '.wma', '.m4a', '.amr', '.3gp']
ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z']

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
                elif not any(file.endswith(ext) for ext in ARCHIVE_EXTENSIONS):
                    # copy the file as is
                    shutil.copy2(src_path, out_path)

def analyze_archive_structure(file_names):
    """Analyze archive structure to determine if it has a single root directory."""
    has_single_root = False
    root_dir_name = None
    
    if file_names:
        # get the top-level directories and files
        top_level_entries = set()
        for name in file_names:
            # normalize path separators and get the first component
            name = name.replace('\\', '/')
            parts = name.split('/')
            if parts[0]:  # ignore empty strings
                top_level_entries.add(parts[0])
        
        # if there's only one top-level entry and it's a directory,
        # then all files are contained within a single root directory
        if len(top_level_entries) == 1:
            potential_root = list(top_level_entries)[0]
            # check if this entry represents a directory by looking for entries inside it
            if any(name.replace('\\', '/').startswith(potential_root + '/') for name in file_names):
                has_single_root = True
                root_dir_name = potential_root
    
    return has_single_root, root_dir_name

def extract_archive(file_path, src_dir, file_names, archive_obj):
    """Extract archive with proper root directory handling."""
    file = os.path.basename(file_path)
    has_single_root, root_dir_name = analyze_archive_structure(file_names)
    new_root_dir = os.path.splitext(file)[0]
    
    if has_single_root:
        # extract everything and rename the root directory to match archive name
        archive_obj.extractall(src_dir)
        old_root_path = os.path.join(src_dir, root_dir_name)
        new_root_path = os.path.join(src_dir, new_root_dir)
        
        # if the target directory already exists, remove it first
        if os.path.exists(new_root_path):
            shutil.rmtree(new_root_path)
        
        shutil.move(old_root_path, new_root_path)
    else:
        # archive has no single root directory or files at root level
        # create a directory with the archive name and extract into it
        extract_path = os.path.join(src_dir, new_root_dir)
        os.makedirs(extract_path, exist_ok=True)
        archive_obj.extractall(extract_path)

def unzip_files(src_dir):
    print(f'UNZIPPING files in {src_dir}...')
    for file in os.listdir(src_dir):
        file_path = os.path.join(src_dir, file)
        if not os.path.isfile(file_path):
            continue

        file_ext = os.path.splitext(file)[1].lower()
        
        if file_ext == '.zip' and zipfile.is_zipfile(file_path):
            print(f'UNZIPPING ZIP {file_path}...')
            with zipfile.ZipFile(file_path) as zf:
                extract_archive(file_path, src_dir, zf.namelist(), zf)
                
        elif file_ext == '.rar' and rarfile.is_rarfile(file_path):
            print(f'UNZIPPING RAR {file_path}...')
            with rarfile.RarFile(file_path) as rf:
                extract_archive(file_path, src_dir, rf.namelist(), rf)
                
        elif file_ext == '.7z':
            print(f'UNZIPPING 7Z {file_path}...')
            with py7zr.SevenZipFile(file_path, mode='r') as szf:
                # py7zr returns a list of ArchiveInfo objects, we need the filenames
                file_names = [info.filename for info in szf.list()]
                extract_archive(file_path, src_dir, file_names, szf)

        print(f'DONE {file}')

if __name__ == '__main__':
    unzip_files(SRC_DIR)
    process_directory(SRC_DIR, OUT_DIR)
