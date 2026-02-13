package main

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pion/turn/v4"
)

type Config struct {
	Host      string
	Port      string
	StaticDir string
	TURNPort  int
}

var (
	clients    = make(map[uuid.UUID]*Client)
	clientLock sync.RWMutex
	nextID     atomic.Uint64
)

type Client struct {
	Id          uuid.UUID
	Connection  *websocket.Conn
	connectedAt time.Time
}

type SignalingMessage struct {
	Event string `json:"event"`
	Data  string `json:"data,omitempty"`
	From  string `json:"from,omitempty"`
	To    string `json:"to,omitempty"`
}

type threadSafeWriter struct {
	*websocket.Conn
	sync.RWMutex
}

type PeerzaUI struct {
	Id          uuid.UUID `json:"id"`
	ConnectedAt string    `json:"connectedAt"`
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

	cli := &Client{
		Id:          uuid.New(),
		Connection:  conn,
		connectedAt: time.Now().UTC(),
	}

	clientID := cli.Id.String()
	log.Printf("New client: %s (%s)", clientID, r.RemoteAddr)

	if err := c.WriteJSON(&SignalingMessage{Event: "welcome", Data: clientID}); err != nil {
		log.Printf("Failed to send welcome to %s: %v", clientID, err)
		return
	}

	clientLock.Lock()
	clients[cli.Id] = cli
	clientLock.Unlock()

	defer removeClient(cli.Id)

	broadCastPeerList()

	for {
		_, raw, err := c.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}

		var msg SignalingMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("[SERVER] [%s] Bad message: %v", clientID, err)
			continue
		}

		msg.From = fmt.Sprintf("%s", cli.Id)

		if msg.To == "" {
			log.Printf("[SERVER][%s] Message has no 'to' field, ignoring: %s", clientID, msg.Event)
			continue
		}

		clientLock.RLock()
		target, ok := clients[uuid.MustParse(msg.To)]
		clientLock.RUnlock()

		if !ok {
			log.Printf("[SERVER][%s] Target %s not found", clientID, msg.To)
			continue
		}

		if err := target.Connection.WriteJSON(&msg); err != nil {
			log.Printf("[SERVER][%s] Failed to relay %s to %s: %v", clientID, msg.Event, msg.To, err)
		} else {
			log.Printf("[SERVER][%s] -> %s : %s", clientID, msg.To, msg.Event)
		}
	}
}

func removeClient(id uuid.UUID) {
	clientLock.Lock()
	delete(clients, id)
	clientLock.Unlock()
	log.Printf("Client %s disconnected (%d remaining)", id, len(clients))
}

func broadCastPeerList() {
	clientLock.RLock()
	defer clientLock.RUnlock()

	peers := make([]PeerzaUI, 0, len(clients))
	for _, c := range clients {
		peers = append(peers, PeerzaUI{
			Id:          c.Id,
			ConnectedAt: c.connectedAt.Format(time.RFC3339),
		})
	}

	data, err := json.Marshal(peers)
	if err != nil {
		log.Printf("Failed to marshal peer list: %v", err)
		return
	}

	msg := &SignalingMessage{Event: "peers", Data: string(data)}
	for _, c := range clients {
		if err := c.Connection.WriteJSON(msg); err != nil {
			log.Printf("Failed to send peer list to %s: %v", c.Id, err)
		}
	}
}

func turnAuthKey(username, realm, password string) []byte {
	h := md5.New()
	h.Write([]byte(username + ":" + realm + ":" + password))
	return h.Sum(nil)
}

const (
	turnPort     = 3478
	turnRealm    = "localhost"
	turnUser     = "peer"
	turnPassword = "peer"
)

func startTURN() {
	udpListener, err := net.ListenPacket("udp4", fmt.Sprintf("0.0.0.0:%d", turnPort))
	if err != nil {
		log.Fatalf("Failed to listen UDP for TURN: %v", err)
	}

	_, err = turn.NewServer(turn.ServerConfig{
		Realm: turnRealm,
		AuthHandler: func(username string, realm string, srcAddr net.Addr) ([]byte, bool) {
			if username == turnUser {
				return turnAuthKey(turnUser, turnRealm, turnPassword), true
			}
			return nil, false
		},
		PacketConnConfigs: []turn.PacketConnConfig{
			{
				PacketConn: udpListener,
				RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{
					RelayAddress: net.ParseIP("127.0.0.1"),
					Address:      "0.0.0.0",
				},
			},
		},
	})
	if err != nil {
		log.Fatalf("Failed to start TURN server: %v", err)
	}

	log.Printf("TURN server listening on UDP :%d (user=%s, pass=%s)", turnPort, turnUser, turnPassword)
}
