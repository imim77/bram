interface SignalingMessage {
    event: 'welcome' | 'peers' | 'offer' | 'answer' | 'candidate';
    data?: string;
    from?: string;
    to?: string;
}

interface ServerPeer {
    peerID: string;
    connectedAt: string;
}

interface SignalingClientCallbacks {
    onWelcome: (peerID: string) => void;
    onPeers: (peers: ServerPeer[]) => void;
    onOffer: (fromID: string, offer: RTCSessionDescriptionInit) => void;
    onAnswer: (fromID: string, answer: RTCSessionDescriptionInit) => void;
    onCandidate: (fromID: string, candidate: RTCIceCandidate) => void;
}

class ClientConnection {
    private socket: WebSocket | null = null;
    private callbacks: SignalingClientCallbacks;

    constructor(callbacks: SignalingClientCallbacks) {
        this.callbacks = callbacks;
        this.connect();
    }

    public connect() {
        const ws = new WebSocket(`ws://${window.location.host}/websocket`);
        ws.onopen = () => addLog("Websocket connected");
        ws.onclose = () => addLog("Websocket closed");
        ws.onerror = (error) => console.error("Websocket error: ", error);
        ws.onmessage = (e) => this.onMessage(e.data);
        this.socket = ws;
    }

    public close() {
        this.socket?.close();
    }

    public sendOffer(peerID: string, sdp: RTCSessionDescriptionInit | null) {
        this.send({ event: 'offer', to: peerID, data: JSON.stringify(sdp) });
    }

    public sendAnswer(peerID: string, sdp: RTCSessionDescriptionInit) {
        this.send({ event: 'answer', to: peerID, data: JSON.stringify(sdp) });
    }

    public sendCandidate(peerID: string, candidate: RTCIceCandidate) {
        this.send({ event: 'candidate', to: peerID, data: JSON.stringify(candidate) });
    }

    public get isConnecting() {
        return this.socket !== null && this.socket.readyState === WebSocket.CONNECTING;
    }

    public get isConnected() {
        return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
    }

    private send(message: SignalingMessage) {
        if (!this.isConnected) return;
        this.socket!.send(JSON.stringify(message));
    }

    private onMessage(raw: string) {
        const msg: SignalingMessage = JSON.parse(raw);

        switch (msg.event) {
            case 'welcome':
                this.callbacks.onWelcome(msg.data!);
                break;
            case 'peers':
                this.callbacks.onPeers(JSON.parse(msg.data!));
                break;
            case 'offer':
                this.callbacks.onOffer(msg.from!, JSON.parse(msg.data!));
                break;
            case 'answer':
                this.callbacks.onAnswer(msg.from!, JSON.parse(msg.data!));
                break;
            case 'candidate':
                this.callbacks.onCandidate(msg.from!, JSON.parse(msg.data!));
                break;
        }
    }
}

class PeerFiles{
    server : ClientConnection
    peerID : string

    constructor(server : ClientConnection,peerID : string){
        this.peerID = peerID;
        this.server = server;
    }
}

class Peer extends PeerFiles{ 
    conn : RTCPeerConnection | null = null;
    channel : RTCDataChannel | null = null;
    iceState : RTCIceConnectionState = 'new';
    pendingCandidates : RTCIceCandidate[] = [];
    isCaller : boolean;

    constructor(serverConnection : ClientConnection, peerID : string, isCaller : boolean){
        super(serverConnection, peerID)
        this.isCaller = isCaller;

    }
    openConnection(peerID : string){
        const host = window.location.hostname
        this.conn = new RTCPeerConnection({
            iceServers:[
                { urls: `stun:${host}:3478` },
                { urls: `turn:${host}:3478`, username: 'peer', credential: 'peer' }
            ]
        })

        this.conn.onicegatheringstatechange = () => {
            if(this.conn) addLog(`ICE gathering: ${this.conn.iceGatheringState}`)
        }

        this.conn.oniceconnectionstatechange = ()=>{
            if(this.conn) addLog(`ICE connection state change: ${this.conn.iceConnectionState}`)
        }

        this.conn.onconnectionstatechange = ()=>{
            if(this.conn) console.log("Connection state change: ", this.conn.connectionState)
        }
    }

    openChannel(){
        if(!this.conn) return;

        const channel = this.conn.createDataChannel('files');
        
        this.conn.createOffer().then((offer) => {
            if(this.conn) return this.conn.setLocalDescription(offer);
        }).then(()=>{
            if(this.conn){
                this.server.sendOffer(this.peerID, this.conn.localDescription);
                addLog(`Sent offer to ${this.peerID}`);
            }
        })
        .catch((error) => {
            console.error(`Failed to create offer for ${this.peerID}:`, error);
        })
    }

    onChannelOpened(event : Event | RTCDataChannelEvent){
        const channel = 'channel' in event ? event.channel : (event.target as RTCDataChannel);
        channel.binaryType = 'arraybuffer';
        //channel.onmessage = (e : MessageEvent) => ??
        
    }

    send(data : ArrayBuffer){
        if(this.channel && this.channel.readyState === 'open') this.channel.send(data);
    }


    isConnected(){
        return this.channel !== null && this.channel.readyState === 'open';
    }

    close(){
        if(this.conn) this.conn.close();
    }
}

















type ChunkCallback = (chunk : ArrayBuffer) => void;
type PartitionEndCallback = (offset : number) => void;



class FileChunker{
    private chunkSize : number = 64000;
    private maxPartitionSize : number = 1e6;
    private offset : number = 0;
    private partitionSize : number = 0;
    private reader : FileReader;
    private file :  File;
    private onChunk : ChunkCallback;
    private onPartitionEnd : PartitionEndCallback;
    

    constructor(file : File, onChunk : ChunkCallback, onPartitionEnd : PartitionEndCallback){
        this.file = file; 
        this.onChunk = onChunk;
        this.onPartitionEnd = onPartitionEnd; 
        this.reader = new FileReader;
        this.reader.addEventListener("load", (e) => {
            if(e.target?.result instanceof ArrayBuffer){
                this.onChunkRead(e.target.result);
            }
        })
    }

    private readChunk(){
        const end = Math.min(this.offset + this.chunkSize, this.file.size);
        const chunk = this.file.slice(this.offset, end);
        this.reader.readAsArrayBuffer(chunk);
    }

    private onChunkRead(chunk : ArrayBuffer){
        this.offset += chunk.byteLength;
        this.partitionSize += chunk.byteLength;
        this.onChunk(chunk);

        if(this.isFileEnd()) return;

        if(this.partitionSize >= this.maxPartitionSize){
            this.onPartitionEnd(this.offset);
            return;
        }
        this.readChunk();
    }

    public nextPartition(){
        this.partitionSize = 0;
        this.readChunk();
    }


    public repeatPartition(){
        this.offset -= this.partitionSize;
        this.nextPartition();
    }

    public isPartitionEnd() {
        return this.partitionSize >= this.maxPartitionSize;
    }

    public isFileEnd() {
        return this.offset >= this.file.size;
    }

    public get progress(){
        return this.file.size > 0 ? this.offset / this.file.size : 0;   
    }


}


interface FileMeta{
    size : number;
    mime? : string;
    name : string;
}

interface DigestedFile{
    name : string;
    mime : string;
    size : number;
    blob : Blob;
}

type DigestCallback = (file : DigestedFile) => void;




class FileDigester{
    //constructor(meta : FileMeta, callback : DigestCallback)
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

 function addLog(text : any) {
        const logs = document.getElementById('logs');
        const entry = document.createElement('div');
        const time = new Date().toLocaleTimeString();
        entry.textContent = `[${time}] ${text}`;
        logs!.appendChild(entry);
        logs!.scrollTop = logs!.scrollHeight;
}

