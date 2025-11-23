// Network module for PeerJS WebRTC multiplayer

export class NetworkManager {
    constructor() {
        this.peer = null;
        this.connection = null;
        this.isHost = false;
        this.gameCode = null;

        this.onConnected = null;
        this.onDisconnected = null;
        this.onData = null;
        this.onError = null;
    }

    generateGameCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    async createGame() {
        return new Promise((resolve, reject) => {
            this.gameCode = this.generateGameCode();
            this.isHost = true;

            // Create peer with game code as ID
            this.peer = new Peer(`hyper-commanders-${this.gameCode}`, {
                debug: 1
            });

            this.peer.on('open', (id) => {
                console.log('Host peer opened with ID:', id);
                resolve(this.gameCode);
            });

            this.peer.on('connection', (conn) => {
                console.log('Incoming connection from:', conn.peer);
                this.connection = conn;
                this.setupConnection();
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                if (this.onError) this.onError(err);
                reject(err);
            });
        });
    }

    async joinGame(gameCode) {
        return new Promise((resolve, reject) => {
            this.gameCode = gameCode.toUpperCase();
            this.isHost = false;

            // Create peer with random ID
            this.peer = new Peer({
                debug: 1
            });

            this.peer.on('open', (id) => {
                console.log('Client peer opened with ID:', id);

                // Connect to host
                const hostId = `hyper-commanders-${this.gameCode}`;
                console.log('Connecting to host:', hostId);

                this.connection = this.peer.connect(hostId, {
                    reliable: true
                });

                this.connection.on('open', () => {
                    console.log('Connected to host!');
                    this.setupConnection();
                    resolve();
                });

                this.connection.on('error', (err) => {
                    console.error('Connection error:', err);
                    reject(err);
                });

                // Timeout for connection
                setTimeout(() => {
                    if (!this.connection || !this.connection.open) {
                        reject(new Error('Connection timeout - game not found'));
                    }
                }, 10000);
            });

            this.peer.on('error', (err) => {
                console.error('Peer error:', err);
                if (err.type === 'peer-unavailable') {
                    reject(new Error('Game not found. Check the code and try again.'));
                } else {
                    reject(err);
                }
            });
        });
    }

    setupConnection() {
        if (!this.connection) return;

        this.connection.on('open', () => {
            console.log('Connection established');
            if (this.onConnected) this.onConnected();
        });

        this.connection.on('data', (data) => {
            if (this.onData) this.onData(data);
        });

        this.connection.on('close', () => {
            console.log('Connection closed');
            if (this.onDisconnected) this.onDisconnected();
        });

        this.connection.on('error', (err) => {
            console.error('Connection error:', err);
            if (this.onError) this.onError(err);
        });

        // If host, the connection might already be open
        if (this.isHost && this.connection.open) {
            if (this.onConnected) this.onConnected();
        }
    }

    send(data) {
        if (this.connection && this.connection.open) {
            this.connection.send(data);
            return true;
        }
        return false;
    }

    disconnect() {
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.gameCode = null;
        this.isHost = false;
    }
}
