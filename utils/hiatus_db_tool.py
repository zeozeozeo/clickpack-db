#!/usr/bin/env python3

import argparse
import os
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta

DEFAULT_DB = "hiatus.db"


def fail(message):
    print(f"ERROR: {message}")
    sys.exit(1)


def connect(path):
    if not os.path.exists(path):
        fail(f"database file not found: {path}")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def table_columns(conn, table):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [row["name"] for row in rows]


def has_downloads_table(conn):
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'"
    ).fetchone()
    return row is not None


def backup(path):
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"{path}.bak.{stamp}"
    shutil.copy2(path, backup_path)
    return backup_path


def confirm(prompt):
    answer = input(f"{prompt} [y/N]: ").strip().lower()
    return answer == "y" or answer == "yes"


def clear_screen():
    os.system("cls" if os.name == "nt" else "clear")


def pause():
    input("\nPress Enter to return to the menu...")


def print_table(headers, rows):
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(str(cell)))
    line = " | ".join(h.ljust(w) for h, w in zip(headers, widths))
    print(line)
    print("-" * len(line))
    for row in rows:
        print(" | ".join(str(cell).ljust(w) for cell, w in zip(row, widths)))


def overview(conn):
    total = conn.execute("SELECT COUNT(*) FROM downloads").fetchone()[0]
    print(f"\nTotal downloads: {total}")
    print("\nDownloads per clickpack:")
    rows = conn.execute(
        "SELECT name, COUNT(*) as c FROM downloads GROUP BY name ORDER BY c DESC, name ASC"
    ).fetchall()
    print_table(["clickpack", "downloads"], [[r["name"], r["c"]] for r in rows])
    print("\nRecent downloads:")
    rows = conn.execute(
        "SELECT id, name, downloaded_at FROM downloads ORDER BY downloaded_at DESC LIMIT 10"
    ).fetchall()
    print_table(["id", "clickpack", "downloaded_at"],
                [[r["id"], r["name"], r["downloaded_at"]] for r in rows])


def vacuum(conn):
    conn.execute("VACUUM")
    conn.commit()


def strip_ips_clear(conn):
    cur = conn.execute("UPDATE downloads SET ip_address = ''")
    conn.commit()
    return cur.rowcount


def strip_ips_drop(conn):
    cols = table_columns(conn, "downloads")
    if "ip_address" not in cols:
        return 0
    conn.execute("ALTER TABLE downloads RENAME TO downloads_old")
    conn.execute(
        "CREATE TABLE downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    )
    conn.execute(
        "INSERT INTO downloads (id, name, downloaded_at) SELECT id, name, downloaded_at FROM downloads_old"
    )
    conn.execute("DROP TABLE downloads_old")
    conn.commit()
    return 1


def delete_by_clickpack(conn, name):
    cur = conn.execute("DELETE FROM downloads WHERE name = ?", (name,))
    conn.commit()
    return cur.rowcount


def delete_by_date_range(conn, start, end):
    if end:
        cur = conn.execute(
            "DELETE FROM downloads WHERE downloaded_at >= ? AND downloaded_at <= ?",
            (start, end),
        )
    else:
        cur = conn.execute(
            "DELETE FROM downloads WHERE downloaded_at >= ?", (start,)
        )
    conn.commit()
    return cur.rowcount


def delete_by_ids(conn, ids):
    if not ids:
        return 0
    placeholders = ",".join("?" for _ in ids)
    cur = conn.execute(f"DELETE FROM downloads WHERE id IN ({placeholders})", ids)
    conn.commit()
    return cur.rowcount


def trim_by_count(conn, max_per_clickpack):
    """Remove downloads beyond max_per_clickpack per clickpack (keeps newest)."""
    rows = conn.execute(
        "SELECT name, COUNT(*) as c FROM downloads GROUP BY name HAVING c > ?",
        (max_per_clickpack,),
    ).fetchall()
    removed = 0
    for row in rows:
        name = row["name"]
        count = row["c"]
        excess = count - max_per_clickpack
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM downloads WHERE name = ? ORDER BY downloaded_at ASC LIMIT ?",
            (name, excess),
        ).fetchall()]
        if ids:
            removed += delete_by_ids(conn, ids)
    return removed


def menu_strip(conn, path):
    clear_screen()
    print("=== Strip IP information ===")
    cols = table_columns(conn, "downloads")
    if "ip_address" not in cols:
        print("The downloads table has no ip_address column. Nothing to strip.")
        pause()
        return
    print("The downloads table still contains an ip_address column.")
    print()
    print("1. Clear IP values (set to empty string, keep column)")
    print("2. Drop ip_address column entirely (rebuild table)")
    print("3. Back")
    choice = input("\nSelect option: ").strip()
    if choice == "1":
        if not confirm("This will clear all IP values. Cannot be undone without a backup. Continue?"):
            return
        backup_path = backup(path)
        print(f"Backup created: {backup_path}")
        count = strip_ips_clear(conn)
        print(f"Cleared IP values for {count} row(s).")
        vacuum(conn)
    elif choice == "2":
        if not confirm("This will drop the ip_address column and its data. Cannot be undone without a backup. Continue?"):
            return
        backup_path = backup(path)
        print(f"Backup created: {backup_path}")
        strip_ips_drop(conn)
        print("Dropped ip_address column.")
        vacuum(conn)
    pause()


def menu_remove_fake(conn, path):
    clear_screen()
    print("=== Remove fake downloads ===")
    print("No IP information is used — downloads are identified by clickpack, date, or row id.")
    print()
    print("1. Remove all downloads for a specific clickpack")
    print("2. Remove downloads in a date range")
    print("3. Remove downloads by specific row id(s)")
    print("4. Trim downloads per clickpack (keeps newest N per clickpack)")
    print("5. Back")
    choice = input("\nSelect option: ").strip()

    if choice == "1":
        name = input("Enter clickpack name: ").strip()
        if not name:
            print("No name entered.")
            pause()
            return
        count = conn.execute("SELECT COUNT(*) FROM downloads WHERE name = ?", (name,)).fetchone()[0]
        if count == 0:
            print(f"No downloads found for '{name}'.")
            pause()
            return
        print(f"Found {count} download(s) for '{name}'.")
        if confirm(f"Delete all {count} downloads for '{name}'?"):
            backup_path = backup(path)
            print(f"Backup created: {backup_path}")
            deleted = delete_by_clickpack(conn, name)
            print(f"Deleted {deleted} download(s).")
            vacuum(conn)
        pause()

    elif choice == "2":
        start = input("Start date (YYYY-MM-DD): ").strip()
        if not start:
            print("No start date entered.")
            pause()
            return
        end = input("End date (YYYY-MM-DD, optional): ").strip()
        try:
            datetime.strptime(start, "%Y-%m-%d")
            if end:
                datetime.strptime(end, "%Y-%m-%d")
        except ValueError:
            print("Invalid date format. Use YYYY-MM-DD.")
            pause()
            return
        count = conn.execute(
            "SELECT COUNT(*) FROM downloads WHERE downloaded_at >= ?" +
            (" AND downloaded_at <= ?" if end else ""),
            ([start] if not end else [start, end]),
        ).fetchone()[0]
        if count == 0:
            print("No downloads found in that date range.")
            pause()
            return
        print(f"Found {count} download(s) in range.")
        if confirm(f"Delete all {count} downloads in range?"):
            backup_path = backup(path)
            print(f"Backup created: {backup_path}")
            deleted = delete_by_date_range(conn, start, end if end else None)
            print(f"Deleted {deleted} download(s).")
            vacuum(conn)
        pause()

    elif choice == "3":
        ids_input = input("Enter row id(s) separated by commas: ").strip()
        if not ids_input:
            print("No ids entered.")
            pause()
            return
        try:
            ids = [int(x.strip()) for x in ids_input.split(",") if x.strip()]
        except ValueError:
            print("Invalid ids — must be integers.")
            pause()
            return
        existing = [r["id"] for r in conn.execute(
            f"SELECT id FROM downloads WHERE id IN ({','.join('?' for _ in ids)})", ids
        ).fetchall()]
        if not existing:
            print("None of those ids exist.")
            pause()
            return
        print(f"Found {len(existing)} download(s).")
        if confirm(f"Delete {len(existing)} download(s)?"):
            backup_path = backup(path)
            print(f"Backup created: {backup_path}")
            deleted = delete_by_ids(conn, existing)
            print(f"Deleted {deleted} download(s).")
            vacuum(conn)
        pause()

    elif choice == "4":
        try:
            max_per = int(input("Max downloads to keep per clickpack: ").strip())
        except ValueError:
            print("Invalid number.")
            pause()
            return
        if max_per < 0:
            print("Number must be non-negative.")
            pause()
            return
        rows = conn.execute(
            "SELECT name, COUNT(*) as c FROM downloads GROUP BY name HAVING c > ?",
            (max_per,),
        ).fetchall()
        if not rows:
            print(f"No clickpacks exceed {max_per} downloads.")
            pause()
            return
        total_excess = sum(r["c"] - max_per for r in rows)
        print(f"Clickpacks exceeding {max_per} downloads: {len(rows)}")
        print(f"Total downloads to remove: {total_excess}")
        if confirm("Trim these downloads (keeps newest per clickpack)?"):
            backup_path = backup(path)
            print(f"Backup created: {backup_path}")
            removed = trim_by_count(conn, max_per)
            print(f"Removed {removed} download(s).")
            vacuum(conn)
        pause()


def main():
    parser = argparse.ArgumentParser(description="TUI tool to clean the hiatus download database")
    parser.add_argument("--db", default=DEFAULT_DB, help="Path to hiatus.db (default: hiatus.db)")
    args = parser.parse_args()

    conn = connect(args.db)
    if not has_downloads_table(conn):
        conn.close()
        fail("downloads table not found in database")

    while True:
        clear_screen()
        print("=== hiatus database cleanup tool ===")
        print(f"Database: {args.db}")
        print()
        print("1. Database overview")
        print("2. Strip IP information")
        print("3. Remove fake downloads")
        print("4. Exit")
        choice = input("\nSelect option: ").strip()

        if choice == "1":
            clear_screen()
            print("=== Database overview ===")
            overview(conn)
            pause()
        elif choice == "2":
            menu_strip(conn, args.db)
        elif choice == "3":
            menu_remove_fake(conn, args.db)
        elif choice == "4":
            conn.close()
            print("Goodbye.")
            break
        else:
            print("Invalid option.")
            pause()


if __name__ == "__main__":
    main()
