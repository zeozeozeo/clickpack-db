package db

import (
	"encoding/json"
	"net/http"
	"time"
)

const endpoint = "https://raw.githubusercontent.com/zeozeozeo/clickpack-db/main/db.json"

type clickpack struct {
	Size int `json:"size"`
}

type clickpackDB struct {
	Clickpacks map[string]clickpack `json:"clickpacks"`
	Version    int                  `json:"version"`
}

var dbCache clickpackDB
var dbCacheTime time.Time

func fetchDB() (clickpackDB, error) {
	if time.Since(dbCacheTime) < time.Hour {
		return dbCache, nil
	}

	resp, err := http.Get(endpoint)
	if err != nil {
		return dbCache, err
	}
	defer resp.Body.Close()

	var db clickpackDB
	err = json.NewDecoder(resp.Body).Decode(&db)
	if err != nil {
		return dbCache, err
	}

	dbCache = db
	dbCacheTime = time.Now()
	return dbCache, nil
}
