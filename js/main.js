import { Game, PLAYER, TICK_RATE } from './game.js';
import { AI } from './ai.js';
import { NetworkManager } from './network.js';

class HyperCommanders {
    constructor() {
        this.game = null;
        this.aiPlayers = []; // Array of AI opponents
        this.network = null;
        this.gameLoop = null;
        this.renderLoop = null;
        this.isMultiplayer = false;
        this.isFFA = false;
        this.mapSeed = null;

        this.screens = {
            menu: document.getElementById('menu-screen'),
            game: document.getElementById('game-screen'),
            gameover: document.getElementById('gameover-screen')
        };

        this.elements = {
            canvas: document.getElementById('game-canvas'),
            turnCounter: document.getElementById('turn-counter'),
            p1Army: document.getElementById('p1-army'),
            p1Land: document.getElementById('p1-land'),
            p2Army: document.getElementById('p2-army'),
            p2Land: document.getElementById('p2-land'),
            gameStatus: document.getElementById('game-status'),
            gameCode: document.getElementById('game-code'),
            yourCode: document.getElementById('your-code'),
            gameoverTitle: document.getElementById('gameover-title'),
            gameoverMessage: document.getElementById('gameover-message')
        };

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Menu buttons
        document.getElementById('btn-vs-ai').addEventListener('click', () => this.startVsAI());
        document.getElementById('btn-ffa').addEventListener('click', () => this.startFFA());
        document.getElementById('btn-create-game').addEventListener('click', () => this.showCreateGame());
        document.getElementById('btn-join-game').addEventListener('click', () => this.showJoinGame());
        document.getElementById('btn-connect').addEventListener('click', () => this.connectToGame());
        document.getElementById('btn-back').addEventListener('click', () => this.hideOnlineOptions());
        document.getElementById('btn-cancel').addEventListener('click', () => this.cancelWaiting());

        // Game buttons
        document.getElementById('btn-surrender').addEventListener('click', () => this.surrender());
        document.getElementById('btn-toggle-queue').addEventListener('click', () => this.toggleQueue());

        // Zoom buttons
        document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoomIn());
        document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoomOut());
        document.getElementById('btn-zoom-reset').addEventListener('click', () => this.resetZoom());

        // Game over buttons
        document.getElementById('btn-play-again').addEventListener('click', () => this.playAgain());
        document.getElementById('btn-main-menu').addEventListener('click', () => this.returnToMenu());

        // Enter key for game code input
        this.elements.gameCode.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.connectToGame();
            }
        });
    }

    showScreen(screenName) {
        Object.values(this.screens).forEach(screen => screen.classList.remove('active'));
        this.screens[screenName].classList.add('active');
    }

    // Menu actions
    startVsAI() {
        this.isMultiplayer = false;
        this.isFFA = false;
        this.mapSeed = Date.now();
        this.initGame(true, PLAYER.ONE, 2);
        this.aiPlayers = [new AI(this.game, PLAYER.TWO)];
        this.startGameLoop();
        this.showScreen('game');
    }

    startFFA() {
        this.isMultiplayer = false;
        this.isFFA = true;
        this.mapSeed = Date.now();
        this.initGame(true, PLAYER.ONE, 8);

        // Create AI for players 2-8
        this.aiPlayers = [];
        for (let i = 2; i <= 8; i++) {
            this.aiPlayers.push(new AI(this.game, i));
        }

        this.startGameLoop();
        this.showScreen('game');
    }

    showCreateGame() {
        document.getElementById('menu-buttons')?.classList.add('hidden');
        document.querySelector('.menu-buttons').classList.add('hidden');
        document.getElementById('online-options').classList.add('hidden');
        document.getElementById('waiting-room').classList.remove('hidden');

        this.network = new NetworkManager();

        this.network.onConnected = () => {
            // Send map seed to client
            this.mapSeed = Date.now();
            this.network.send({
                type: 'init',
                seed: this.mapSeed
            });

            this.isMultiplayer = true;
            this.initGame(true, PLAYER.ONE);
            this.setupNetworkCallbacks();
            this.startGameLoop();
            this.showScreen('game');
        };

        this.network.onError = (err) => {
            alert('Error: ' + err.message);
            this.cancelWaiting();
        };

        this.network.createGame().then((code) => {
            this.elements.yourCode.textContent = code;
        }).catch((err) => {
            alert('Failed to create game: ' + err.message);
            this.cancelWaiting();
        });
    }

    showJoinGame() {
        document.querySelector('.menu-buttons').classList.add('hidden');
        document.getElementById('online-options').classList.remove('hidden');
        document.getElementById('waiting-room').classList.add('hidden');
        this.elements.gameCode.value = '';
        this.elements.gameCode.focus();
    }

    hideOnlineOptions() {
        document.querySelector('.menu-buttons').classList.remove('hidden');
        document.getElementById('online-options').classList.add('hidden');
        document.getElementById('waiting-room').classList.add('hidden');
    }

    async connectToGame() {
        const code = this.elements.gameCode.value.trim().toUpperCase();
        if (!code || code.length < 4) {
            alert('Please enter a valid game code');
            return;
        }

        this.network = new NetworkManager();

        this.network.onData = (data) => {
            if (data.type === 'init') {
                this.mapSeed = data.seed;
                this.isMultiplayer = true;
                this.initGame(false, PLAYER.TWO);
                this.setupNetworkCallbacks();
                this.startGameLoop();
                this.showScreen('game');
            }
        };

        this.network.onError = (err) => {
            alert('Error: ' + err.message);
        };

        try {
            await this.network.joinGame(code);
        } catch (err) {
            alert('Failed to join game: ' + err.message);
        }
    }

    cancelWaiting() {
        if (this.network) {
            this.network.disconnect();
            this.network = null;
        }
        this.hideOnlineOptions();
    }

    // Game initialization
    initGame(isHost, playerNumber, playerCount = 2) {
        this.game = new Game(this.elements.canvas, isHost, playerNumber, playerCount);
        this.game.generateMap(this.mapSeed);

        this.game.onGameOver = (winner) => {
            this.endGame(winner);
        };

        this.game.onMove = (move) => {
            if (this.isMultiplayer && this.network) {
                this.network.send({
                    type: 'move',
                    move: move
                });
            }
        };

        // Update UI
        const queueBtn = document.getElementById('btn-toggle-queue');
        queueBtn.textContent = this.game.queueEnabled ? 'Queue: ON' : 'Queue: OFF';

        this.updateStats();
        this.game.render();
    }

    setupNetworkCallbacks() {
        if (!this.network) return;

        this.network.onData = (data) => {
            switch (data.type) {
                case 'move':
                    // Execute opponent's move
                    const move = data.move;
                    this.game.executeMove(
                        move.fromX,
                        move.fromY,
                        move.toX,
                        move.toY,
                        this.game.opponentNumber
                    );
                    break;

                case 'surrender':
                    this.game.captureGeneral(this.game.opponentNumber, this.game.playerNumber);
                    break;
            }
        };

        this.network.onDisconnected = () => {
            if (!this.game.gameOver) {
                this.elements.gameStatus.textContent = 'Opponent disconnected';
                this.game.captureGeneral(this.game.opponentNumber, this.game.playerNumber);
            }
        };
    }

    startGameLoop() {
        // Game tick loop
        this.gameLoop = setInterval(() => {
            this.game.tick();

            // AI tick for all AI players
            for (const ai of this.aiPlayers) {
                ai.tick();
            }

            this.updateStats();
        }, TICK_RATE);

        // Render loop (60fps)
        const render = () => {
            this.game.render();
            this.renderLoop = requestAnimationFrame(render);
        };
        render();
    }

    stopGameLoop() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
        if (this.renderLoop) {
            cancelAnimationFrame(this.renderLoop);
            this.renderLoop = null;
        }
    }

    updateStats() {
        const p1Stats = this.game.getStats(PLAYER.ONE);
        const p2Stats = this.game.getStats(PLAYER.TWO);

        this.elements.p1Army.textContent = p1Stats.army;
        this.elements.p1Land.textContent = p1Stats.land;
        this.elements.p2Army.textContent = p2Stats.army;
        this.elements.p2Land.textContent = p2Stats.land;
        this.elements.turnCounter.textContent = `Turn: ${this.game.turn}`;

        // Update game status
        if (this.game.moveQueue.length > 0) {
            this.elements.gameStatus.textContent = `Queued moves: ${this.game.moveQueue.length}`;
        } else {
            this.elements.gameStatus.textContent = '';
        }
    }

    // Game actions
    surrender() {
        if (confirm('Are you sure you want to surrender?')) {
            if (this.isMultiplayer && this.network) {
                this.network.send({ type: 'surrender' });
            }
            this.game.captureGeneral(this.game.playerNumber, this.game.opponentNumber);
        }
    }

    toggleQueue() {
        this.game.queueEnabled = !this.game.queueEnabled;
        const btn = document.getElementById('btn-toggle-queue');
        btn.textContent = this.game.queueEnabled ? 'Queue: ON' : 'Queue: OFF';

        if (!this.game.queueEnabled) {
            this.game.moveQueue = [];
        }
    }

    zoomIn() {
        if (!this.game) return;
        const canvas = this.game.canvas;
        const rect = canvas.getBoundingClientRect();
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        this.game.setZoom(this.game.zoom * 1.2, centerX, centerY);
        this.game.render();
    }

    zoomOut() {
        if (!this.game) return;
        const canvas = this.game.canvas;
        const rect = canvas.getBoundingClientRect();
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        this.game.setZoom(this.game.zoom * 0.8, centerX, centerY);
        this.game.render();
    }

    resetZoom() {
        if (!this.game) return;
        this.game.zoom = 1;
        this.game.centerOnGeneral();
        this.game.render();
    }

    endGame(winner) {
        this.stopGameLoop();

        const isVictory = winner === this.game.playerNumber;

        this.elements.gameoverTitle.textContent = isVictory ? 'VICTORY!' : 'DEFEAT';
        this.elements.gameoverTitle.className = isVictory ? 'victory' : 'defeat';

        if (this.isFFA) {
            this.elements.gameoverMessage.textContent = isVictory
                ? 'You are the last commander standing!'
                : 'Your general has been captured. Better luck next time!';
        } else {
            this.elements.gameoverMessage.textContent = isVictory
                ? 'You have captured the enemy general!'
                : 'Your general has been captured.';
        }

        // Do final render showing all tiles
        this.game.render();

        setTimeout(() => {
            this.showScreen('gameover');
        }, 1500);
    }

    playAgain() {
        if (this.isMultiplayer) {
            // For multiplayer, return to menu
            this.returnToMenu();
        } else if (this.isFFA) {
            // For FFA game, start new FFA game
            this.startFFA();
        } else {
            // For 1v1 AI game, start new 1v1 game
            this.startVsAI();
        }
    }

    returnToMenu() {
        this.stopGameLoop();

        if (this.network) {
            this.network.disconnect();
            this.network = null;
        }

        this.game = null;
        this.aiPlayers = [];
        this.isMultiplayer = false;
        this.isFFA = false;

        this.hideOnlineOptions();
        this.showScreen('menu');
    }
}

// Initialize the game when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new HyperCommanders();
});
