interface WebSocketMessage{
    type: string;
    [key : string] : any;
}


class ClientConnection{
    private socket : WebSocket | null = null;

    constructor(){
        this.connect();
    }

    public connect() : void {
        const ws = new WebSocket(`ws://${window.location.host}/websocket`);
        ws.onopen = ()=> console.log("Websocket server connected");
        ws.onclose = () => console.log("Websocket server closed!");
        ws.onerror = (error) => console.error("Websocket error: ", error);
        this.socket = ws;
    }

    public send(message : WebSocketMessage) : void {
        if(!this.isConnected) return;
        this.socket!.send(JSON.stringify(message));
    }

    private onMessage(msg : string){
        const parsedMsg : WebSocketMessage = JSON.parse(msg);
        console.log("WS message: ", parsedMsg);

        switch(parsedMsg.type){
            default:
                console.log("WS unknown message type: ", parsedMsg);
        }
    }

    public get isConnecting() : boolean {
        return this.socket !== null && this.socket.readyState == WebSocket.CONNECTING;
    }

    public get isConnected() : boolean{ 
        return this.socket !== null && this.socket.readyState == WebSocket.OPEN;
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

    nextPartition(){
        this.partitionSize = 0;
        this.readChunk();
    }


    repeatPartition(){
        this.offset -= this.partitionSize;
        this.nextPartition();
    }

    isPartitionEnd() : boolean{
        return this.partitionSize >= this.maxPartitionSize;
    }

    isFileEnd() : boolean{
        return this.offset >= this.file.size;
    }

    public get progress(): number {
    return this.file.size > 0 ? this.offset / this.file.size : 0;
  }


}

