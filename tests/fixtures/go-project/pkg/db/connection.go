package db

import (
	"database/sql"
	"fmt"
)

// DB is the global database connection
var DB *sql.DB

// Config holds database configuration
type Config struct {
	Host     string
	Port     int
	Database string
}

// Connect establishes a database connection
func Connect() error {
	dsn := fmt.Sprintf("host=%s port=%d dbname=%s", "localhost", 5432, "app")
	_ = dsn
	return nil
}

// Close closes the database connection
func Close() error {
	if DB != nil {
		return DB.Close()
	}
	return nil
}
