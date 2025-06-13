#!/usr/bin/env python3

"""
Trace the addition dates of clickpack zip files from git history.

This script goes through the git history to find when each clickpack zip file
was first added to the repository, so we can populate the "added_at" field
in the database.
"""

import os
import subprocess
import json
import sys
from datetime import datetime, timezone
from typing import Dict, Optional, List
import argparse


def run_git_command(cmd: List[str], cwd: str = None) -> str:
    """Run a git command and return the output."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=cwd or os.getcwd(),
            check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Git command failed: {' '.join(cmd)}")
        print(f"Error: {e.stderr}")
        return ""


def get_first_commit_date(file_path: str) -> Optional[str]:
    """
    Get the date when a file was first added to the repository.
    
    Args:
        file_path: Path to the file relative to repository root
        
    Returns:
        ISO format date string when the file was first added, or None if not found
    """
    # Use git log with --follow to track file renames and --reverse to get oldest first
    cmd = [
        "git", "log", 
        "--follow",           # Follow renames
        "--reverse",          # Oldest commits first
        "--format=%aI",       # Author date in ISO format
        "--diff-filter=A",    # Only show when file was added (not modified)
        "--",                 # Separator for file path
        file_path
    ]
    
    output = run_git_command(cmd)
    if output:
        # Return the first (oldest) date
        return output.split('\n')[0]
    
    # Fallback: try without --diff-filter=A in case the file was added in a complex way
    cmd = [
        "git", "log",
        "--follow",
        "--reverse", 
        "--format=%aI",
        "--",
        file_path
    ]
    
    output = run_git_command(cmd)
    if output:
        return output.split('\n')[0]
    
    return None


def get_all_zip_files() -> List[str]:
    """
    Get all zip files that have ever existed in the out/ directory from git history.
    
    Returns:
        List of zip file paths relative to repository root
    """
    # Get all files that ever existed in the out/ directory
    cmd = [
        "git", "log",
        "--name-only",
        "--pretty=format:",
        "--all",
        "--",
        "out/*.zip"
    ]
    
    output = run_git_command(cmd)
    if not output:
        return []
    
    # Split lines and remove empty ones, then deduplicate
    files = [line.strip() for line in output.split('\n') if line.strip()]
    return list(set(files))


def extract_clickpack_name(zip_path: str) -> str:
    """
    Extract clickpack name from zip file path.
    
    Args:
        zip_path: Path like "out/clickpack_name.zip"
        
    Returns:
        The clickpack name (filename without .zip extension)
    """
    filename = os.path.basename(zip_path)
    if filename.endswith('.zip'):
        return filename[:-4]  # Remove .zip extension
    return filename


def load_current_db(db_path: str) -> Dict:
    """Load the current database JSON file."""
    try:
        with open(db_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Database file not found: {db_path}")
        return {}
    except json.JSONDecodeError as e:
        print(f"Error parsing database JSON: {e}")
        return {}


def load_traced_dates(traced_dates_file: str) -> Dict[str, str]:
    """Load previously traced dates from JSON file."""
    try:
        with open(traced_dates_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as e:
        print(f"Error parsing traced dates JSON: {e}")
        return {}


def main():
    parser = argparse.ArgumentParser(description='Trace clickpack addition dates from git history')
    parser.add_argument('--db', type=str, default='db.json', help='Database file path')
    parser.add_argument('--output', type=str, help='Output file for addition dates (JSON format)')
    parser.add_argument('--update-db', action='store_true', help='Update the database file with added_at fields')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    parser.add_argument('--traced-dates', type=str, default='utils/traced_dates.json', help='Path to traced dates JSON file')
    parser.add_argument('--force-rescan', action='store_true', help='Force rescan of git history even if traced dates file exists')
    
    args = parser.parse_args()
    
    # Check if we already have traced dates and should use them
    if not args.force_rescan and os.path.exists(args.traced_dates):
        print(f"Loading previously traced dates from {args.traced_dates}")
        addition_dates = load_traced_dates(args.traced_dates)
        
        if addition_dates:
            print(f"Loaded {len(addition_dates)} clickpack addition dates from file")
            failed_files = []
        else:
            print("Failed to load traced dates, falling back to git history scan")
            addition_dates = {}
    else:
        if args.force_rescan:
            print("Force rescan requested, scanning git history...")
        else:
            print("No traced dates file found, scanning git history...")
        
        # Check if we're in a git repository
        if not os.path.exists('.git'):
            print("Error: This script must be run from the root of a git repository")
            sys.exit(1)
        
        print("Scanning git history for clickpack zip files...")
        
        # Get all zip files from git history
        zip_files = get_all_zip_files()
        
        if not zip_files:
            print("No zip files found in git history")
            sys.exit(1)
        
        print(f"Found {len(zip_files)} zip files in git history")
        
        # Build a mapping of clickpack names to addition dates
        addition_dates = {}
        failed_files = []
        
        for i, zip_path in enumerate(zip_files):
            clickpack_name = extract_clickpack_name(zip_path)
            
            if args.verbose:
                print(f"Processing {i+1}/{len(zip_files)}: {clickpack_name}")
            else:
                # Show progress
                print(f"Processing {i+1}/{len(zip_files)}...", end='\r')
            
            # Get the first commit date for this file
            first_date = get_first_commit_date(zip_path)
            
            if first_date:
                # Convert the date to UTC
                git_date = datetime.fromisoformat(first_date.replace('Z', '+00:00'))
                utc_date = git_date.astimezone(timezone.utc)
                utc_iso = utc_date.isoformat()
                
                # If we already have a date for this clickpack, keep the earliest one
                if clickpack_name in addition_dates:
                    existing_date = datetime.fromisoformat(addition_dates[clickpack_name].replace('Z', '+00:00'))
                    if utc_date < existing_date:
                        addition_dates[clickpack_name] = utc_iso
                else:
                    addition_dates[clickpack_name] = utc_iso
                
                if args.verbose:
                    print(f"  -> Added on: {first_date}")
            else:
                failed_files.append(zip_path)
                if args.verbose:
                    print(f"  -> Could not determine addition date")
        
        print()  # New line after progress indicator
        
        print(f"Successfully traced {len(addition_dates)} clickpack addition dates")
        if failed_files:
            print(f"Failed to trace {len(failed_files)} files:")
            for f in failed_files:
                print(f"  - {f}")
    
    # Save results to output file if specified
    if args.output:
        print(f"Saving results to {args.output}")
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(addition_dates, f, indent=2, ensure_ascii=False)
    
    # Update database if requested
    if args.update_db:
        print(f"Loading database from {args.db}")
        db = load_current_db(args.db)
        
        if not db or 'clickpacks' not in db:
            print("Error: Could not load database or database has no clickpacks")
            sys.exit(1)
        
        updated_count = 0
        for clickpack_name, date in addition_dates.items():
            if clickpack_name in db['clickpacks']:
                # Only update if the field doesn't exist or is empty
                if 'added_at' not in db['clickpacks'][clickpack_name] or not db['clickpacks'][clickpack_name]['added_at']:
                    db['clickpacks'][clickpack_name]['added_at'] = date
                    updated_count += 1
        
        if updated_count > 0:
            print(f"Updated {updated_count} clickpacks with addition dates")
            
            # Create backup
            backup_path = f"{args.db}.backup"
            print(f"Creating backup at {backup_path}")
            with open(backup_path, 'w', encoding='utf-8') as f:
                json.dump(load_current_db(args.db), f, separators=(',', ':'))
            
            # Save updated database
            print(f"Saving updated database to {args.db}")
            with open(args.db, 'w', encoding='utf-8') as f:
                json.dump(db, f, separators=(',', ':'))
        else:
            print("No clickpacks needed updating")
    
    # Print summary
    print("\n=== SUMMARY ===")
    print(f"Total clickpacks with traced dates: {len(addition_dates)}")
    if addition_dates:
        dates = [datetime.fromisoformat(d.replace('Z', '+00:00')) for d in addition_dates.values()]
        earliest = min(dates).strftime('%Y-%m-%d')
        latest = max(dates).strftime('%Y-%m-%d')
        print(f"Date range: {earliest} to {latest} (all times in UTC)")
    
    if not args.output and not args.update_db:
        print("\nUse --output to save results to a file")
        print("Use --update-db to update the database with addition dates")


if __name__ == "__main__":
    main()
