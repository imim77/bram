class ClientConnection {
    socket = null;
    constructor() {
        this.connect();
    }
    connect() {
        const ws = new WebSocket(`ws://${window.location.host}/websocket`);
        ws.onopen = () => console.log("Websocket server connected");
        ws.onclose = () => console.log("Websocket server closed!");
        ws.onerror = (error) => console.error("Websocket error: ", error);
        this.socket = ws;
    }
    send(message) {
        if (!this.isConnected)
            return;
        this.socket.send(JSON.stringify(message));
    }
    onMessage(msg) {
        const parsedMsg = JSON.parse(msg);
        console.log("WS message: ", parsedMsg);
        switch (parsedMsg.type) {
            default:
                console.log("WS unknown message type: ", parsedMsg);
        }
    }
    get isConnecting() {
        return this.socket !== null && this.socket.readyState == WebSocket.CONNECTING;
    }
    get isConnected() {
        return this.socket !== null && this.socket.readyState == WebSocket.OPEN;
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
export {};
