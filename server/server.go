package main

import (
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Config struct {
	Host      string
	Port      string
	StaticDir string
	TURNPort  int
}

type threadSafeWriter struct {
	*websocket.Conn
	sync.RWMutex
}

func (t *threadSafeWriter) WriteJSON(v any) error {
	t.Lock()
	defer t.Unlock()
	return t.Conn.WriteJSON(v)
}

func NewServer(cfg *Config, wsHandler http.Handler) http.Handler {
	mux := http.NewServeMux()
	addRoutes(mux, cfg, wsHandler)
	var handler http.Handler = mux
	return handler

}

func addRoutes(mux *http.ServeMux, cfg *Config, wsHandler http.Handler) {
	fileServer := http.FileServer(http.Dir(cfg.StaticDir))
	mux.Handle("/", fileServer)
	mux.Handle("/websocket", wsHandler)
}

func webSocketHandler(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	c := &threadSafeWriter{Conn: conn}
	defer c.Close()

	log.Printf("WebSocket client connected: %s", r.RemoteAddr)

	for {
		_, msg, err := c.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}
		log.Printf("Received: %s", msg)
	}
}
