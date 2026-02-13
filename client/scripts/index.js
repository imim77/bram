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
class Peer {
    conn = null;
    channel = null;
    iceState = 'new';
    pendingCandidates = [];
    isCaller;
    constructor(serverConnection, peerID, isCaller) {
        this.isCaller = isCaller;
    }
    openConnection(peerID) {
        const host = window.location.hostname;
        this.conn = new RTCPeerConnection({
            iceServers: [
                { urls: `stun:${host}:3478` },
                { urls: `turn:${host}:3478`, username: 'peer', credential: 'peer' }
            ]
        });
        this.conn.onconnectionstatechange = () => {
            if (this.conn)
                console.log("Connection state change: ", this.conn.connectionState);
        };
    }
    openChannel() {
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
const client = new ClientConnection({
    onWelcome: (peerID) => {
        addLog(`Welcome! You are ${peerID}`);
    },
    onPeers: (peers) => {
        addLog(`Peer list updated: ${peers.length} peer(s)`);
    },
    onOffer: (fromID, offer) => {
        addLog(`Offer from ${fromID}`);
    },
    onAnswer: (fromID, answer) => {
        addLog(`Answer from ${fromID}`);
    },
    onCandidate: (fromID, candidate) => {
        addLog(`ICE candidate from ${fromID}`);
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
