package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"canal-plus/backend/internal/app"
)

func main() {
	log.SetFlags(0)
	server, err := app.NewServer()
	if err != nil {
		appLog("error", "server", "Failed to start Canal Plus backend: "+err.Error())
		os.Exit(1)
	}

	appLog("info", "server", "Canal Plus backend listening on http://localhost:"+server.Port())
	if err := http.ListenAndServe(":"+server.Port(), server); err != nil {
		appLog("error", "server", "Canal Plus backend stopped: "+err.Error())
		os.Exit(1)
	}
}

func appLog(level string, thread string, message string) {
	log.Printf("[%s][%s][%s]%s", time.Now().Format(time.RFC3339), level, thread, message)
}
