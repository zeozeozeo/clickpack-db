package db

import (
	"fmt"
	"log/slog"
)

// ErrClickpackNotInIndex is returned when a clickpack is not found in the index.
var ErrClickpackNotInIndex = fmt.Errorf("clickpack not found in index")

// IncrementDownload records a download for the given clickpack name and IP address
func IncrementDownload(clickpackName, ipAddress string) error {
	index, err := fetchDB()
	if err != nil {
		slog.Error("failed to fetch clickpack index during IncrementDownload", "name", clickpackName, "error", err)
		if len(index.Clickpacks) == 0 {
			return fmt.Errorf("failed to fetch clickpack index: %w", err)
		}
		slog.Warn("using cached index")
	}

	if _, exists := index.Clickpacks[clickpackName]; !exists {
		slog.Warn("attempted to download non-existent clickpack", "name", clickpackName)
		return ErrClickpackNotInIndex
	}

	_, err = globalDB.Exec(`INSERT INTO downloads (name, ip_address) VALUES (?, ?)`, clickpackName, ipAddress)
	if err != nil {
		slog.Error("failed to insert download record", "name", clickpackName, "error", err)
		return fmt.Errorf("failed to insert download record: %w", err)
	}
	slog.Info("download recorded", "name", clickpackName)
	return nil
}

// GetClickpackDownloads returns the download count for a specific clickpack.
func GetClickpackDownloads(clickpackName string) (int, error) {
	index, err := fetchDB()
	if err != nil {
		slog.Error("failed to fetch clickpack index during GetClickpackDownloads", "name", clickpackName, "error", err)
		return 0, fmt.Errorf("failed to fetch clickpack index: %w", err)
	}

	if _, exists := index.Clickpacks[clickpackName]; !exists {
		slog.Warn("attempted to query non-existent clickpack", "name", clickpackName)
		return 0, ErrClickpackNotInIndex
	}

	var count int
	err = globalDB.QueryRow(`SELECT COUNT(*) FROM downloads WHERE name = ?`, clickpackName).Scan(&count)
	if err != nil {
		slog.Error("failed to query downloads for clickpack", "name", clickpackName, "error", err)
		return 0, fmt.Errorf("failed to query downloads for clickpack %s: %w", clickpackName, err)
	}
	return count, nil
}

// GetAllDownloads returns a map of clickpack names to their download counts.
func GetAllDownloads() (map[string]int, error) {
	rows, err := globalDB.Query(`SELECT name, COUNT(*) as count FROM downloads GROUP BY name`)
	if err != nil {
		slog.Error("failed to query all downloads", "error", err)
		return nil, fmt.Errorf("failed to query all downloads: %w", err)
	}
	defer rows.Close()

	result := make(map[string]int)
	for rows.Next() {
		var name string
		var count int
		if err := rows.Scan(&name, &count); err != nil {
			slog.Error("failed to scan download row", "error", err)
			return nil, fmt.Errorf("failed to scan download row: %w", err)
		}
		result[name] = count
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating download rows", "error", err)
		return nil, fmt.Errorf("error iterating download rows: %w", err)
	}
	return result, nil
}

// GetClickpackDownloadsSince returns downloads for a specific clickpack since given date.
// dateStr should be in "YYYY-MM-DD" format.
func GetClickpackDownloadsSince(clickpackName, dateStr string) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM downloads WHERE name = ? AND date(downloaded_at) >= date(?)`
	err := globalDB.QueryRow(query, clickpackName, dateStr).Scan(&count)
	if err != nil {
		slog.Error("failed to query clickpack downloads since date",
			"name", clickpackName, "date", dateStr, "error", err)
		return 0, fmt.Errorf("failed to query clickpack downloads since date %s: %w", dateStr, err)
	}
	return count, nil
}

// GetAllDownloadsSince returns downloads for all clickpacks since given date.
// dateStr should be in "YYYY-MM-DD" format.
func GetAllDownloadsSince(dateStr string) (map[string]int, error) {
	rows, err := globalDB.Query(
		`SELECT name, COUNT(*) as count FROM downloads
		WHERE date(downloaded_at) >= date(?)
		GROUP BY name`, dateStr)
	if err != nil {
		slog.Error("failed to query all downloads since date", "date", dateStr, "error", err)
		return nil, fmt.Errorf("failed to query all downloads since date %s: %w", dateStr, err)
	}
	defer rows.Close()

	result := make(map[string]int)
	for rows.Next() {
		var name string
		var count int
		if err := rows.Scan(&name, &count); err != nil {
			slog.Error("failed to scan download row", "error", err)
			return nil, fmt.Errorf("failed to scan download row: %w", err)
		}
		result[name] = count
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating download rows", "error", err)
		return nil, fmt.Errorf("error iterating download rows: %w", err)
	}
	return result, nil
}
