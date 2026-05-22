package main

import (
	"log"
	"net/http"

	"canal-plus/backend/internal/app"
)

func main() {
	server, err := app.NewServer()
	if err != nil {
		log.Fatalf("failed to start Canal Plus backend: %v", err)
	}

	log.Printf("Canal Plus backend listening on http://localhost:%s", server.Port())
	if err := http.ListenAndServe(":"+server.Port(), server); err != nil {
		log.Fatal(err)
	}
}
