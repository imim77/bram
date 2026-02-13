class ClientConnection {
    socket = null;
    callbacks;
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.connect();
    }
    connect() {
        const ws = new WebSocket(`ws://${window.location.host}/websocket`);
        ws.onopen = () => addLog("Websocket connected");
        ws.onclose = () => addLog("Websocket closed");
        ws.onerror = (error) => console.error("Websocket error: ", error);
        ws.onmessage = (e) => this.onMessage(e.data);
        this.socket = ws;
    }
    close() {
        this.socket?.close();
    }
    sendOffer(peerID, sdp) {
        this.send({ event: 'offer', to: peerID, data: JSON.stringify(sdp) });
    }
    sendAnswer(peerID, sdp) {
        this.send({ event: 'answer', to: peerID, data: JSON.stringify(sdp) });
    }
    sendCandidate(peerID, candidate) {
        this.send({ event: 'candidate', to: peerID, data: JSON.stringify(candidate) });
    }
    get isConnecting() {
        return this.socket !== null && this.socket.readyState === WebSocket.CONNECTING;
    }
    get isConnected() {
        return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
    }
    send(message) {
        if (!this.isConnected)
            return;
        this.socket.send(JSON.stringify(message));
    }
    onMessage(raw) {
        const msg = JSON.parse(raw);
        switch (msg.event) {
            case 'welcome':
                this.callbacks.onWelcome(msg.data);
                break;
            case 'peers':
                this.callbacks.onPeers(JSON.parse(msg.data));
                break;
            case 'offer':
                this.callbacks.onOffer(msg.from, JSON.parse(msg.data));
                break;
            case 'answer':
                this.callbacks.onAnswer(msg.from, JSON.parse(msg.data));
                break;
            case 'candidate':
                this.callbacks.onCandidate(msg.from, JSON.parse(msg.data));
                break;
        }
    }
}
class PeerFiles {
    server;
    peerID;
    constructor(server, peerID) {
        this.peerID = peerID;
        this.server = server;
    }
}
class Peer extends PeerFiles {
    conn = null;
    channel = null;
    iceState = 'new';
    pendingCandidates = [];
    isCaller;
    constructor(serverConnection, peerID, isCaller) {
        super(serverConnection, peerID);
        this.isCaller = isCaller;
        this.connect(this.peerID, this.isCaller);
    }
    connect(peerID, isCaller) {
        this.openConnection(this.peerID);
        if (isCaller) {
            this.openChannel();
        }
        else {
            if (this.conn) {
                this.conn.ondatachannel = (e) => this.onChannelOpened(e);
            }
        }
    }
    openConnection(peerID) {
        const host = window.location.hostname;
        this.conn = new RTCPeerConnection({
            iceServers: [
                { urls: `stun:${host}:3478` },
                { urls: `turn:${host}:3478`, username: 'peer', credential: 'peer' }
            ]
        });
        this.conn.onicecandidate = (e) => this.onICECandidate(e);
        this.conn.onicegatheringstatechange = () => {
            if (this.conn)
                addLog(`ICE gathering: ${this.conn.iceGatheringState}`);
        };
        this.conn.oniceconnectionstatechange = () => {
            if (this.conn)
                addLog(`ICE connection state change: ${this.conn.iceConnectionState}`);
        };
        this.conn.onconnectionstatechange = () => {
            if (this.conn)
                console.log("Connection state change: ", this.conn.connectionState);
        };
    }
    openChannel() {
        if (!this.conn)
            return;
        const channel = this.conn.createDataChannel('files');
        this.conn.createOffer().then((offer) => {
            if (this.conn)
                return this.conn.setLocalDescription(offer);
        }).then(() => {
            if (this.conn) {
                this.server.sendOffer(this.peerID, this.conn.localDescription);
                addLog(`Sent offer to ${this.peerID}`);
            }
        })
            .catch((error) => {
            console.error(`Failed to create offer for ${this.peerID}:`, error);
        });
    }
    onICECandidate(event) {
        if (!event.candidate) {
            addLog(`[${this.peerID}] ICE gathering complete`);
            return;
        }
        const c = event.candidate;
        addLog(`[${this.peerID}] ICE candidate: ${c.type || 'unknown'} ${c.address || c.candidate.split(' ')[4] || '?'} ${c.protocol || ''}`);
        this.server.sendCandidate(this.peerID, event.candidate);
    }
    onChannelOpened(event) {
        const channel = 'channel' in event ? event.channel : event.target;
        channel.binaryType = 'arraybuffer';
        addLog(`Data channel with ${this.peerID} opened`);
        //channel.onmessage = (e : MessageEvent) => 
        channel.onclose = () => this.onChannelClosed();
        this.channel = channel;
    }
    onChannelClosed() {
        addLog(`DataChannel with ${this.peerID} closed`);
    }
    handleRemoteOffer(offer) {
        if (!this.conn)
            return;
        this.conn.setRemoteDescription(offer).then(() => {
            this.flushPendingCandidates();
            if (this.conn) {
                return this.conn.createAnswer();
            }
        }).then((answer) => {
            if (this.conn && answer) {
                return this.conn.setLocalDescription(answer);
            }
        }).then(() => {
            if (this.conn) {
                this.server.sendAnswer(this.peerID, this.conn.localDescription);
                addLog(`Sent answer to ${this.peerID}`);
            }
        }).catch((error) => {
            console.error(`Failed to handle offer from ${this.peerID}:`, error);
        });
    }
    handleRemoteAnswer(answer) {
        if (!this.conn)
            return;
        this.conn.setRemoteDescription(answer).then(() => {
            this.flushPendingCandidates();
        })
            .catch((error) => { console.error(`Failed to handle answer from ${this.peerID}:`, error); });
    }
    flushPendingCandidates() {
        if (!this.conn)
            return;
        for (const c of this.pendingCandidates) {
            this.conn.addIceCandidate(c).catch((error) => { console.error(`Failed to add pending ICE candidate:`, error); });
        }
        this.pendingCandidates = [];
    }
    handleRemoteCandidate(candidate) {
        if (!this.conn)
            return;
        if (this.conn.remoteDescription) {
            this.conn.addIceCandidate(candidate).catch((error) => { console.error(`Failed to add ICE candidate from ${this.peerID}:`, error); });
        }
        else {
            this.pendingCandidates.push(candidate);
        }
    }
    send(data) {
        if (this.channel && this.channel.readyState === 'open')
            this.channel.send(data);
    }
    isConnected() {
        return this.channel !== null && this.channel.readyState === 'open';
    }
    close() {
        if (this.conn)
            this.conn.close();
    }
}
class FileChunker {
    chunkSize = 64000;
    maxPartitionSize = 1e6;
    offset = 0;
    partitionSize = 0;
    reader;
    file;
    onChunk;
    onPartitionEnd;
    constructor(file, onChunk, onPartitionEnd) {
        this.file = file;
        this.onChunk = onChunk;
        this.onPartitionEnd = onPartitionEnd;
        this.reader = new FileReader;
        this.reader.addEventListener("load", (e) => {
            if (e.target?.result instanceof ArrayBuffer) {
                this.onChunkRead(e.target.result);
            }
        });
    }
    readChunk() {
        const end = Math.min(this.offset + this.chunkSize, this.file.size);
        const chunk = this.file.slice(this.offset, end);
        this.reader.readAsArrayBuffer(chunk);
    }
    onChunkRead(chunk) {
        this.offset += chunk.byteLength;
        this.partitionSize += chunk.byteLength;
        this.onChunk(chunk);
        if (this.isFileEnd())
            return;
        if (this.partitionSize >= this.maxPartitionSize) {
            this.onPartitionEnd(this.offset);
            return;
        }
        this.readChunk();
    }
    nextPartition() {
        this.partitionSize = 0;
        this.readChunk();
    }
    repeatPartition() {
        this.offset -= this.partitionSize;
        this.nextPartition();
    }
    isPartitionEnd() {
        return this.partitionSize >= this.maxPartitionSize;
    }
    isFileEnd() {
        return this.offset >= this.file.size;
    }
    get progress() {
        return this.file.size > 0 ? this.offset / this.file.size : 0;
    }
}
class FileDigester {
}
// --- App state ---
let myPeerID = '';
const peers = new Map();
const div = document.getElementById("peers-div");
const client = new ClientConnection({
    onWelcome: (peerID) => {
        myPeerID = peerID;
        addLog(`Welcome! You are ${peerID}`);
        const entry1 = document.createElement('div');
        entry1.textContent = `[PeerID] ${peerID}`;
        div?.append(entry1);
    },
    onPeers: (serverPeers) => {
        addLog(`Peer list updated: ${serverPeers.length} peer(s)`);
        for (const sp of serverPeers) {
            // Skip ourselves and already-known peers
            const divara = document.createElement('div');
            divara.textContent = `[PEER] ${sp.id}`;
            div?.appendChild(divara);
            if (sp.id === myPeerID || peers.has(sp.id))
                continue;
            // Only the peer with the smaller ID initiates (prevents both sides sending offers)
            const isCaller = myPeerID < sp.id;
            addLog(`New peer ${sp.id} (${isCaller ? 'calling' : 'waiting for offer'})`);
            const peer = new Peer(client, sp.id, isCaller);
            peers.set(sp.id, peer);
        }
    },
    onOffer: (fromID, offer) => {
        addLog(`Offer from ${fromID}`);
        let peer = peers.get(fromID);
        if (!peer) {
            peer = new Peer(client, fromID, false);
            peers.set(fromID, peer);
        }
        peer.handleRemoteOffer(offer);
    },
    onAnswer: (fromID, answer) => {
        addLog(`Answer from ${fromID}`);
        const peer = peers.get(fromID);
        if (peer) {
            peer.handleRemoteAnswer(answer);
        }
        else {
            addLog(`No peer found for answer from ${fromID}`);
        }
    },
    onCandidate: (fromID, candidate) => {
        addLog(`ICE candidate from ${fromID}`);
        const peer = peers.get(fromID);
        if (peer) {
            peer.handleRemoteCandidate(candidate);
        }
        else {
            addLog(`No peer found for candidate from ${fromID}`);
        }
    },
});
function addLog(text) {
    const logs = document.getElementById('logs');
    const entry = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${text}`;
    logs.appendChild(entry);
    logs.scrollTop = logs.scrollHeight;
}
export {};
