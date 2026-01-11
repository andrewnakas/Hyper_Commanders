// Game Constants
export const TILE_SIZE = 40;
export const TICK_RATE = 500; // ms per turn
export const LAND_GROWTH_INTERVAL = 25; // turns between land growth
export const MAP_SIZE = 20;

// Tile Types
export const TILE = {
    EMPTY: 0,
    MOUNTAIN: 1,
    CITY: 2,
    GENERAL: 3
};

// Player Constants
export const PLAYER = {
    NONE: 0,
    ONE: 1,
    TWO: 2
};

// Colors
export const COLORS = {
    [PLAYER.NONE]: '#444',
    [PLAYER.ONE]: '#4a90d9',
    [PLAYER.TWO]: '#d94a4a',
    MOUNTAIN: '#333',
    CITY_NEUTRAL: '#888',
    FOG: '#1a1a1a',
    FOG_EXPLORED: '#2a2a2a',
    SELECTED: '#fff',
    GENERAL: '#ffd700'
};

export class Game {
    constructor(canvas, isHost = true, playerNumber = PLAYER.ONE) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.isHost = isHost;
        this.playerNumber = playerNumber;
        this.opponentNumber = playerNumber === PLAYER.ONE ? PLAYER.TWO : PLAYER.ONE;

        this.map = [];
        this.turn = 0;
        this.selectedTile = null;
        this.queueOrigin = null; // The tile where queued moves start from
        this.moveQueue = [];
        this.queueEnabled = true;
        this.gameOver = false;
        this.winner = null;

        this.generals = { [PLAYER.ONE]: null, [PLAYER.TWO]: null };
        this.visibility = new Set();
        this.explored = new Set();

        this.onGameOver = null;
        this.onStateChange = null;
        this.onMove = null;

        this.setupCanvas();
        this.bindEvents();
    }

    setupCanvas() {
        this.canvas.width = MAP_SIZE * TILE_SIZE;
        this.canvas.height = MAP_SIZE * TILE_SIZE;
    }

    generateMap(seed = null) {
        // Initialize empty map
        this.map = [];
        for (let y = 0; y < MAP_SIZE; y++) {
            this.map[y] = [];
            for (let x = 0; x < MAP_SIZE; x++) {
                this.map[y][x] = {
                    type: TILE.EMPTY,
                    owner: PLAYER.NONE,
                    army: 0
                };
            }
        }

        // Use seeded random for consistent map generation
        const random = seed ? this.seededRandom(seed) : Math.random;

        // Place mountains (15-20% of map)
        const mountainCount = Math.floor(MAP_SIZE * MAP_SIZE * (0.15 + random() * 0.05));
        for (let i = 0; i < mountainCount; i++) {
            const x = Math.floor(random() * MAP_SIZE);
            const y = Math.floor(random() * MAP_SIZE);
            this.map[y][x].type = TILE.MOUNTAIN;
        }

        // Place neutral cities (5-8 cities)
        const cityCount = 5 + Math.floor(random() * 4);
        for (let i = 0; i < cityCount; i++) {
            let x, y;
            let attempts = 0;
            do {
                x = Math.floor(random() * MAP_SIZE);
                y = Math.floor(random() * MAP_SIZE);
                attempts++;
            } while (this.map[y][x].type !== TILE.EMPTY && attempts < 100);

            if (this.map[y][x].type === TILE.EMPTY) {
                this.map[y][x].type = TILE.CITY;
                this.map[y][x].army = 40 + Math.floor(random() * 20); // Neutral city defense
            }
        }

        // Place generals (at least 15 tiles apart)
        const placeGeneral = (player, preferredSide) => {
            let bestX, bestY;
            let attempts = 0;

            do {
                if (preferredSide === 'left') {
                    bestX = 2 + Math.floor(random() * (MAP_SIZE / 3));
                } else {
                    bestX = Math.floor(MAP_SIZE * 2 / 3) + Math.floor(random() * (MAP_SIZE / 3 - 2));
                }
                bestY = 2 + Math.floor(random() * (MAP_SIZE - 4));
                attempts++;
            } while (
                (this.map[bestY][bestX].type !== TILE.EMPTY ||
                (this.generals[PLAYER.ONE] && this.distance(bestX, bestY, this.generals[PLAYER.ONE].x, this.generals[PLAYER.ONE].y) < 15)) &&
                attempts < 100
            );

            this.map[bestY][bestX].type = TILE.GENERAL;
            this.map[bestY][bestX].owner = player;
            this.map[bestY][bestX].army = 1;
            this.generals[player] = { x: bestX, y: bestY };
        };

        placeGeneral(PLAYER.ONE, 'left');
        placeGeneral(PLAYER.TWO, 'right');

        // Clear mountains near generals
        for (const player of [PLAYER.ONE, PLAYER.TWO]) {
            const gen = this.generals[player];
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const nx = gen.x + dx;
                    const ny = gen.y + dy;
                    if (this.inBounds(nx, ny) && this.map[ny][nx].type === TILE.MOUNTAIN) {
                        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
                            this.map[ny][nx].type = TILE.EMPTY;
                        }
                    }
                }
            }
        }

        this.updateVisibility();
    }

    seededRandom(seed) {
        let s = seed;
        return () => {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
        };
    }

    distance(x1, y1, x2, y2) {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }

    inBounds(x, y) {
        return x >= 0 && x < MAP_SIZE && y >= 0 && y < MAP_SIZE;
    }

    getTile(x, y) {
        if (!this.inBounds(x, y)) return null;
        return this.map[y][x];
    }

    updateVisibility() {
        this.visibility.clear();

        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                if (this.map[y][x].owner === this.playerNumber) {
                    // Add visible tiles (current tile + adjacent)
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (this.inBounds(nx, ny)) {
                                const key = `${nx},${ny}`;
                                this.visibility.add(key);
                                this.explored.add(key);
                            }
                        }
                    }
                }
            }
        }
    }

    isVisible(x, y) {
        return this.visibility.has(`${x},${y}`);
    }

    isExplored(x, y) {
        return this.explored.has(`${x},${y}`);
    }

    tick() {
        if (this.gameOver) return;

        this.turn++;

        // Process move queue
        if (this.moveQueue.length > 0) {
            const move = this.moveQueue.shift();
            const from = this.getTile(move.fromX, move.fromY);
            const to = this.getTile(move.toX, move.toY);

            // Validate move before executing
            const isValidMove = from &&
                                to &&
                                from.owner === this.playerNumber &&
                                from.army > 1 &&
                                to.type !== TILE.MOUNTAIN;

            if (isValidMove) {
                this.executeMove(move.fromX, move.fromY, move.toX, move.toY, this.playerNumber);

                // Update selected tile to follow the army to the destination
                // This keeps the selection at the "head" of the moving army
                if (this.queueOrigin) {
                    this.selectedTile = { x: move.toX, y: move.toY };
                }
            } else {
                // Invalid move - clear entire queue
                this.clearMoveQueue();
            }

            // Clear queue origin when queue is empty
            if (this.moveQueue.length === 0) {
                this.queueOrigin = null;
            }
        }

        // Army growth
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const tile = this.map[y][x];

                if (tile.owner !== PLAYER.NONE) {
                    // Generals and cities grow every turn
                    if (tile.type === TILE.GENERAL || tile.type === TILE.CITY) {
                        tile.army++;
                    }
                    // All land grows every LAND_GROWTH_INTERVAL turns
                    else if (this.turn % LAND_GROWTH_INTERVAL === 0) {
                        tile.army++;
                    }
                }
            }
        }

        this.updateVisibility();

        if (this.onStateChange) {
            this.onStateChange(this.getState());
        }
    }

    executeMove(fromX, fromY, toX, toY, player) {
        const from = this.getTile(fromX, fromY);
        const to = this.getTile(toX, toY);

        if (!from || !to) return false;
        if (from.owner !== player) return false;
        if (from.army <= 1) return false;
        if (to.type === TILE.MOUNTAIN) return false;
        if (!this.isAdjacent(fromX, fromY, toX, toY)) return false;

        const movingArmy = from.army - 1;
        from.army = 1;

        if (to.owner === player) {
            // Moving to own tile
            to.army += movingArmy;
        } else if (to.owner === PLAYER.NONE && to.type !== TILE.CITY) {
            // Capturing neutral empty tile
            to.owner = player;
            to.army = movingArmy;
        } else {
            // Combat
            if (movingArmy > to.army) {
                // Attacker wins
                const remaining = movingArmy - to.army;

                // Check if captured general
                if (to.type === TILE.GENERAL) {
                    this.captureGeneral(to.owner, player);
                    to.type = TILE.CITY; // General becomes city
                }

                to.owner = player;
                to.army = remaining;
            } else if (movingArmy === to.army) {
                // Draw - defender keeps tile with 0 army
                to.army = 0;
            } else {
                // Defender wins
                to.army -= movingArmy;
            }
        }

        return true;
    }

    captureGeneral(loser, winner) {
        this.gameOver = true;
        this.winner = winner;

        // Transfer all of loser's territory to winner
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                if (this.map[y][x].owner === loser) {
                    this.map[y][x].owner = winner;
                }
            }
        }

        if (this.onGameOver) {
            this.onGameOver(winner);
        }
    }

    isAdjacent(x1, y1, x2, y2) {
        return (Math.abs(x1 - x2) === 1 && y1 === y2) ||
               (Math.abs(y1 - y2) === 1 && x1 === x2);
    }

    queueMove(fromX, fromY, toX, toY) {
        if (this.queueEnabled) {
            this.moveQueue.push({ fromX, fromY, toX, toY });
        } else {
            this.moveQueue = [{ fromX, fromY, toX, toY }];
        }

        if (this.onMove) {
            this.onMove({ fromX, fromY, toX, toY });
        }
    }

    selectTile(x, y) {
        const tile = this.getTile(x, y);
        if (!tile) return;

        if (this.selectedTile) {
            // Check if clicking the same tile
            if (this.selectedTile.x === x && this.selectedTile.y === y) {
                // Clicking same tile - do nothing, keep selection and queue
                return;
            }

            // Try to move
            if (this.isAdjacent(this.selectedTile.x, this.selectedTile.y, x, y)) {
                const from = this.getTile(this.selectedTile.x, this.selectedTile.y);
                const to = this.getTile(x, y);

                if (from.owner === this.playerNumber && from.army > 1 && to.type !== TILE.MOUNTAIN) {
                    this.queueMove(this.selectedTile.x, this.selectedTile.y, x, y);

                    // Keep selection on destination if it's ours or will be ours
                    if (to.owner === this.playerNumber || from.army - 1 > to.army) {
                        this.selectedTile = { x, y };
                    } else {
                        this.selectedTile = null;
                    }
                    return;
                }
            }
        }

        // Select new tile if it's visible and ours
        if (this.isVisible(x, y) && tile.owner === this.playerNumber) {
            // Only clear queue if selecting a different tile
            if (!this.selectedTile || this.selectedTile.x !== x || this.selectedTile.y !== y) {
                this.clearMoveQueue();
            }
            this.selectedTile = { x, y };
        } else {
            this.selectedTile = null;
        }
    }

    moveSelected(dx, dy) {
        if (!this.selectedTile) return;

        // Determine the position we're queuing from
        let fromX, fromY;

        if (this.moveQueue.length > 0) {
            // Queue from the last move's destination
            const lastMove = this.moveQueue[this.moveQueue.length - 1];
            fromX = lastMove.toX;
            fromY = lastMove.toY;
        } else {
            // Queue from selected tile
            fromX = this.selectedTile.x;
            fromY = this.selectedTile.y;

            // Validate that the origin is valid for moving
            const origin = this.getTile(fromX, fromY);
            if (!origin || origin.owner !== this.playerNumber || origin.army <= 1) {
                return;
            }

            // Set the queue origin
            this.queueOrigin = { x: fromX, y: fromY };
        }

        const toX = fromX + dx;
        const toY = fromY + dy;

        // Check if destination is valid
        if (!this.inBounds(toX, toY)) return;

        const to = this.getTile(toX, toY);
        if (!to || to.type === TILE.MOUNTAIN) return;

        // Queue the move
        this.queueMove(fromX, fromY, toX, toY);
    }

    clearMoveQueue() {
        this.moveQueue = [];
        this.queueOrigin = null;
    }

    getStats(player) {
        let army = 0;
        let land = 0;

        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                if (this.map[y][x].owner === player) {
                    army += this.map[y][x].army;
                    land++;
                }
            }
        }

        return { army, land };
    }

    getState() {
        return {
            map: this.map,
            turn: this.turn,
            generals: this.generals,
            gameOver: this.gameOver,
            winner: this.winner
        };
    }

    setState(state) {
        this.map = state.map;
        this.turn = state.turn;
        this.generals = state.generals;
        this.gameOver = state.gameOver;
        this.winner = state.winner;
        this.updateVisibility();
    }

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const tile = this.map[y][x];
                const px = x * TILE_SIZE;
                const py = y * TILE_SIZE;
                const visible = this.isVisible(x, y);
                const explored = this.isExplored(x, y);

                // Background
                if (tile.type === TILE.MOUNTAIN) {
                    // Mountains always visible
                    if (!visible && !explored) {
                        ctx.fillStyle = '#1a1a1a'; // Dark mountain in fog
                    } else if (!visible && explored) {
                        ctx.fillStyle = '#2a2a2a'; // Explored mountain
                    } else {
                        ctx.fillStyle = COLORS.MOUNTAIN; // Visible mountain
                    }
                } else if (!visible && !explored) {
                    ctx.fillStyle = COLORS.FOG;
                } else if (!visible && explored) {
                    ctx.fillStyle = COLORS.FOG_EXPLORED;
                } else if (tile.owner !== PLAYER.NONE) {
                    ctx.fillStyle = COLORS[tile.owner];
                } else if (tile.type === TILE.CITY) {
                    ctx.fillStyle = COLORS.CITY_NEUTRAL;
                } else {
                    ctx.fillStyle = '#3a3a3a';
                }

                ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);

                if (visible || tile.type === TILE.MOUNTAIN) {
                    // Draw tile icon
                    if (tile.type === TILE.MOUNTAIN) {
                        ctx.fillStyle = '#666';
                        ctx.font = `${TILE_SIZE * 0.6}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('▲', px + TILE_SIZE / 2, py + TILE_SIZE / 2);
                    } else if (tile.type === TILE.CITY) {
                        ctx.fillStyle = tile.owner !== PLAYER.NONE ? '#fff' : '#ddd';
                        ctx.font = `${TILE_SIZE * 0.5}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('🏰', px + TILE_SIZE / 2, py + TILE_SIZE / 2 - 5);
                    } else if (tile.type === TILE.GENERAL) {
                        ctx.fillStyle = COLORS.GENERAL;
                        ctx.font = `${TILE_SIZE * 0.5}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('👑', px + TILE_SIZE / 2, py + TILE_SIZE / 2 - 5);
                    }

                    // Draw army count
                    if (visible && tile.army > 0 && tile.type !== TILE.MOUNTAIN) {
                        ctx.fillStyle = '#fff';
                        ctx.font = `bold ${TILE_SIZE * 0.35}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        const textY = (tile.type === TILE.CITY || tile.type === TILE.GENERAL)
                            ? py + TILE_SIZE * 0.75
                            : py + TILE_SIZE / 2;
                        ctx.fillText(tile.army.toString(), px + TILE_SIZE / 2, textY);
                    }
                }

                // Selection highlight
                if (this.selectedTile && this.selectedTile.x === x && this.selectedTile.y === y) {
                    ctx.strokeStyle = COLORS.SELECTED;
                    ctx.lineWidth = 3;
                    ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                }

                // Queue origin highlight
                if (this.queueOrigin && this.queueOrigin.x === x && this.queueOrigin.y === y && this.moveQueue.length > 0) {
                    ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]);
                    ctx.strokeRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);
                    ctx.setLineDash([]);
                }
            }
        }

        // Draw move queue preview with arrows
        if (this.moveQueue.length > 0) {
            for (const move of this.moveQueue) {
                const fromPx = move.fromX * TILE_SIZE + TILE_SIZE / 2;
                const fromPy = move.fromY * TILE_SIZE + TILE_SIZE / 2;
                const toPx = move.toX * TILE_SIZE + TILE_SIZE / 2;
                const toPy = move.toY * TILE_SIZE + TILE_SIZE / 2;

                // Calculate arrow direction
                const dx = toPx - fromPx;
                const dy = toPy - fromPy;
                const angle = Math.atan2(dy, dx);

                // Draw arrow line
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(fromPx, fromPy);
                ctx.lineTo(toPx, toPy);
                ctx.stroke();

                // Draw arrowhead
                const arrowSize = 8;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.beginPath();
                ctx.moveTo(toPx, toPy);
                ctx.lineTo(
                    toPx - arrowSize * Math.cos(angle - Math.PI / 6),
                    toPy - arrowSize * Math.sin(angle - Math.PI / 6)
                );
                ctx.lineTo(
                    toPx - arrowSize * Math.cos(angle + Math.PI / 6),
                    toPy - arrowSize * Math.sin(angle + Math.PI / 6)
                );
                ctx.closePath();
                ctx.fill();
            }
        }
    }

    bindEvents() {
        this.canvas.addEventListener('click', (e) => {
            if (this.gameOver) return;

            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = Math.floor((e.clientX - rect.left) * scaleX / TILE_SIZE);
            const y = Math.floor((e.clientY - rect.top) * scaleY / TILE_SIZE);

            this.selectTile(x, y);
            this.render();
        });

        document.addEventListener('keydown', (e) => {
            if (this.gameOver) return;

            // Clear move queue with 'q' key
            if (e.key === 'q' || e.key === 'Q') {
                e.preventDefault();
                this.clearMoveQueue();
                this.render();
                return;
            }

            const keyMap = {
                'ArrowUp': [0, -1],
                'ArrowDown': [0, 1],
                'ArrowLeft': [-1, 0],
                'ArrowRight': [1, 0],
                'w': [0, -1],
                's': [0, 1],
                'a': [-1, 0],
                'd': [1, 0],
                'W': [0, -1],
                'S': [0, 1],
                'A': [-1, 0],
                'D': [1, 0]
            };

            if (keyMap[e.key]) {
                e.preventDefault();
                const [dx, dy] = keyMap[e.key];
                this.moveSelected(dx, dy);
                this.render();
            }
        });
    }
}
