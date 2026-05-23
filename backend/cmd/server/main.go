package main

import (
	"log"
	"net/http"
	"os"

	"canal-plus/backend/internal/app"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "task-process" {
		if err := app.RunTaskProcessCLI(); err != nil {
			log.Fatalf("failed to run task process: %v", err)
		}
		return
	}

	server, err := app.NewServer()
	if err != nil {
		log.Fatalf("failed to start Canal Plus backend: %v", err)
	}

	log.Printf("Canal Plus backend listening on http://localhost:%s", server.Port())
	if err := http.ListenAndServe(":"+server.Port(), server); err != nil {
		log.Fatal(err)
	}
}
