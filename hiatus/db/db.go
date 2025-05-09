package db

import (
	"database/sql"
	"fmt"
	"log/slog"

	_ "github.com/mattn/go-sqlite3" // SQLite driver
)

var globalDB *sql.DB

func InitDB(dataSourceName string) error {
	var err error
	globalDB, err = sql.Open("sqlite3", dataSourceName)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	if err = globalDB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}
	slog.Info("database connection established", slog.String("dataSource", dataSourceName))

	migrations := []string{
		`CREATE TABLE IF NOT EXISTS downloads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			ip_address TEXT NOT NULL,
			downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for i, migration := range migrations {
		_, err = globalDB.Exec(migration)
		if err != nil {
			return fmt.Errorf("failed to execute migration %d: %w", i+1, err)
		}
	}
	slog.Info("database tables ensured")

	return nil
}
