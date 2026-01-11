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
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
    SIX: 6,
    SEVEN: 7,
    EIGHT: 8
};

// Colors
export const COLORS = {
    [PLAYER.NONE]: '#444',
    [PLAYER.ONE]: '#4a90d9',   // Blue
    [PLAYER.TWO]: '#d94a4a',   // Red
    [PLAYER.THREE]: '#4ad94a', // Green
    [PLAYER.FOUR]: '#d9d94a',  // Yellow
    [PLAYER.FIVE]: '#d94ad9',  // Magenta
    [PLAYER.SIX]: '#4ad9d9',   // Cyan
    [PLAYER.SEVEN]: '#d9944a', // Orange
    [PLAYER.EIGHT]: '#9a4ad9', // Purple
    MOUNTAIN: '#333',
    CITY_NEUTRAL: '#888',
    FOG: '#1a1a1a',
    FOG_EXPLORED: '#2a2a2a',
    SELECTED: '#fff',
    GENERAL: '#ffd700'
};

export class Game {
    constructor(canvas, isHost = true, playerNumber = PLAYER.ONE, playerCount = 2) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.isHost = isHost;
        this.playerNumber = playerNumber;
        this.playerCount = playerCount;
        this.opponentNumber = playerNumber === PLAYER.ONE ? PLAYER.TWO : PLAYER.ONE;

        this.map = [];
        this.turn = 0;
        this.selectedTile = null;
        this.queueOrigin = null; // The tile where queued moves start from
        this.moveQueue = [];
        this.queueEnabled = true;
        this.gameOver = false;
        this.winner = null;
        this.alivePlayers = new Set();

        this.generals = {};
        for (let i = 1; i <= playerCount; i++) {
            this.generals[i] = null;
            this.alivePlayers.add(i);
        }
        this.visibility = new Set();
        this.explored = new Set();

        this.onGameOver = null;
        this.onStateChange = null;
        this.onMove = null;

        this.lastClickTime = 0;
        this.lastClickTile = null;

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

        // Place generals
        if (this.playerCount === 2) {
            // 1v1: place on left and right sides
            this.placeGeneralAtSide(PLAYER.ONE, 'left', random);
            this.placeGeneralAtSide(PLAYER.TWO, 'right', random);
        } else {
            // FFA: place in a circle around the map
            const centerX = MAP_SIZE / 2;
            const centerY = MAP_SIZE / 2;
            const radius = MAP_SIZE / 3;

            for (let i = 1; i <= this.playerCount; i++) {
                const angle = (2 * Math.PI * (i - 1)) / this.playerCount;
                const preferredX = Math.floor(centerX + radius * Math.cos(angle));
                const preferredY = Math.floor(centerY + radius * Math.sin(angle));

                this.placeGeneralNear(i, preferredX, preferredY, random);
            }
        }

        // Clear mountains near generals
        for (let player = 1; player <= this.playerCount; player++) {
            const gen = this.generals[player];
            if (!gen) continue;

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

    placeGeneralAtSide(player, side, random) {
        let bestX, bestY;
        let attempts = 0;

        do {
            if (side === 'left') {
                bestX = 2 + Math.floor(random() * (MAP_SIZE / 3));
            } else {
                bestX = Math.floor(MAP_SIZE * 2 / 3) + Math.floor(random() * (MAP_SIZE / 3 - 2));
            }
            bestY = 2 + Math.floor(random() * (MAP_SIZE - 4));
            attempts++;
        } while (
            (this.map[bestY][bestX].type !== TILE.EMPTY || !this.isGeneralFarEnough(bestX, bestY, player)) &&
            attempts < 100
        );

        this.map[bestY][bestX].type = TILE.GENERAL;
        this.map[bestY][bestX].owner = player;
        this.map[bestY][bestX].army = 1;
        this.generals[player] = { x: bestX, y: bestY };
    }

    placeGeneralNear(player, preferredX, preferredY, random) {
        let bestX, bestY;
        let attempts = 0;
        const searchRadius = 5;

        do {
            bestX = preferredX + Math.floor((random() - 0.5) * searchRadius * 2);
            bestY = preferredY + Math.floor((random() - 0.5) * searchRadius * 2);
            bestX = Math.max(2, Math.min(MAP_SIZE - 3, bestX));
            bestY = Math.max(2, Math.min(MAP_SIZE - 3, bestY));
            attempts++;
        } while (
            (this.map[bestY][bestX].type !== TILE.EMPTY || !this.isGeneralFarEnough(bestX, bestY, player)) &&
            attempts < 200
        );

        this.map[bestY][bestX].type = TILE.GENERAL;
        this.map[bestY][bestX].owner = player;
        this.map[bestY][bestX].army = 1;
        this.generals[player] = { x: bestX, y: bestY };
    }

    isGeneralFarEnough(x, y, currentPlayer) {
        const minDistance = this.playerCount === 2 ? 15 : 8;

        for (let player = 1; player < currentPlayer; player++) {
            const gen = this.generals[player];
            if (gen && this.distance(x, y, gen.x, gen.y) < minDistance) {
                return false;
            }
        }
        return true;
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
        // Remove loser from alive players
        this.alivePlayers.delete(loser);

        // Transfer all of loser's territory to winner
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                if (this.map[y][x].owner === loser) {
                    this.map[y][x].owner = winner;
                }
            }
        }

        // Check if only one player remains (game over)
        if (this.alivePlayers.size === 1) {
            this.gameOver = true;
            this.winner = Array.from(this.alivePlayers)[0];

            if (this.onGameOver) {
                this.onGameOver(this.winner);
            }
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

    selectTile(x, y, isDoubleClick = false) {
        const tile = this.getTile(x, y);
        if (!tile) return;

        if (this.selectedTile) {
            // Check if clicking the same tile
            if (this.selectedTile.x === x && this.selectedTile.y === y) {
                // Double-click: split army and move half
                if (isDoubleClick && tile.owner === this.playerNumber && tile.army > 1 && this.moveQueue.length > 0) {
                    const move = this.moveQueue[0]; // Get first queued move
                    const from = this.getTile(move.fromX, move.fromY);
                    const to = this.getTile(move.toX, move.toY);

                    if (from && to && from.owner === this.playerNumber && from.army > 1 && to.type !== TILE.MOUNTAIN) {
                        // Move half the army (rounded down)
                        const halfArmy = Math.floor(from.army / 2);
                        const remainingArmy = from.army - halfArmy;

                        from.army = remainingArmy;

                        if (to.owner === this.playerNumber) {
                            to.army += halfArmy;
                        } else if (to.owner === PLAYER.NONE && to.type !== TILE.CITY) {
                            to.owner = this.playerNumber;
                            to.army = halfArmy;
                        } else {
                            // Combat with half army
                            if (halfArmy > to.army) {
                                const remaining = halfArmy - to.army;
                                if (to.type === TILE.GENERAL) {
                                    this.captureGeneral(to.owner, this.playerNumber);
                                    to.type = TILE.CITY;
                                }
                                to.owner = this.playerNumber;
                                to.army = remaining;
                            } else {
                                to.army -= halfArmy;
                            }
                        }

                        // Remove first move from queue since we executed it
                        this.moveQueue.shift();
                        if (this.moveQueue.length === 0) {
                            this.queueOrigin = null;
                        }

                        this.updateVisibility();
                    }
                }
                // Single click same tile - do nothing, keep selection and queue
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

        // Select any visible tile (not just owned tiles)
        if (this.isVisible(x, y)) {
            // Clear queue when selecting a different tile, or selecting a tile we can't queue from
            const canQueue = tile.owner === this.playerNumber && tile.army > 1;
            if (!canQueue || (this.selectedTile && (this.selectedTile.x !== x || this.selectedTile.y !== y))) {
                this.clearMoveQueue();
            }
            this.selectedTile = { x, y };
        } else {
            this.selectedTile = null;
        }
    }

    moveSelected(dx, dy) {
        if (!this.selectedTile) return;

        const currentTile = this.getTile(this.selectedTile.x, this.selectedTile.y);
        const newX = this.selectedTile.x + dx;
        const newY = this.selectedTile.y + dy;

        // Check if current selection is on a tile we can't queue from
        // (not ours, or ours but has only 1 army)
        const canQueueFromHere = currentTile &&
                                 currentTile.owner === this.playerNumber &&
                                 currentTile.army > 1;

        if (!canQueueFromHere && this.moveQueue.length === 0) {
            // Just move the selection, don't queue
            if (this.inBounds(newX, newY)) {
                const targetTile = this.getTile(newX, newY);
                if (targetTile && targetTile.type !== TILE.MOUNTAIN && this.isVisible(newX, newY)) {
                    this.selectedTile = { x: newX, y: newY };
                }
            }
            return;
        }

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

            // Detect double-click (within 300ms)
            const now = Date.now();
            const isDoubleClick = this.lastClickTile &&
                                  this.lastClickTile.x === x &&
                                  this.lastClickTile.y === y &&
                                  (now - this.lastClickTime) < 300;

            if (isDoubleClick) {
                this.selectTile(x, y, true);
                this.lastClickTile = null;
                this.lastClickTime = 0;
            } else {
                this.selectTile(x, y, false);
                this.lastClickTile = { x, y };
                this.lastClickTime = now;
            }

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
