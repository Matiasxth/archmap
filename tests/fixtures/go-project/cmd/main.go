package main

import (
	"fmt"
	"net/http"
	"github.com/example/myapp/pkg/handlers"
	"github.com/example/myapp/pkg/db"
)

func main() {
	db.Connect()
	router := handlers.NewRouter()
	fmt.Println("Server starting on :8080")
	http.ListenAndServe(":8080", router)
}
