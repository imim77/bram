


class ClientConnection{
    constructor(){ 
        this.connect();
    }

    connect(){
        const ws = new WebSocket(`ws://${window.location.host}/websocket`) 
        ws.onopen = ()=> console.log("Websocket server connected!")
        ws.onclose = () => console.log("Websocket server closed!")
        ws.onmessage = (e) => this.onMessage(e.data)
        this.socket = ws;
    }


    onMessage(msg){
        msg = JSON.parse(msg);
        console.log("WS message: ", msg)
        switch(msg.type){
            default:
                console.log("WS: unknown message type", msg)
        }
    }

    send(message){
        if(!this._isConnected) return;
        this.socket.send(JSON.stringify(message));
    }

    _isConnected(){
        return this.socket && this.socket.readyState === this.socket.OPEN;
    }

    _isConnecting(){
        return this.socket && this.socket.readyState === this.socket.CONNECTING;
    }
}

const ws = new ClientConnection();
