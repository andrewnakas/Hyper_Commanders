import { TILE, PLAYER, MAP_SIZE } from './game.js';

export class AI {
    constructor(game, playerNumber = PLAYER.TWO) {
        this.game = game;
        this.playerNumber = playerNumber;
        this.opponent = playerNumber === PLAYER.ONE ? PLAYER.TWO : PLAYER.ONE;
        this.moveQueue = [];
        this.expandDirection = Math.random() < 0.5 ? 1 : -1;
        this.lastKnownEnemyPosition = null;
        this.explorationTarget = null;
    }

    tick() {
        if (this.game.gameOver) return;

        // Process one move per tick
        if (this.moveQueue.length > 0) {
            const move = this.moveQueue.shift();
            if (this.isValidMove(move)) {
                this.game.executeMove(move.fromX, move.fromY, move.toX, move.toY, this.playerNumber);
            }
            return;
        }

        // Generate new moves
        this.planMoves();
    }

    isValidMove(move) {
        const from = this.game.getTile(move.fromX, move.fromY);
        const to = this.game.getTile(move.toX, move.toY);

        return from &&
               to &&
               from.owner === this.playerNumber &&
               from.army > 1 &&
               to.type !== TILE.MOUNTAIN &&
               this.game.isAdjacent(move.fromX, move.fromY, move.toX, move.toY);
    }

    planMoves() {
        const myTiles = this.getMyTiles();
        const general = this.game.generals[this.playerNumber];

        if (myTiles.length === 0) return;

        // Find tile with most army (excluding general if we have few tiles)
        let bestTile = null;
        let bestArmy = 0;

        for (const tile of myTiles) {
            // Protect general early game
            const isGeneral = tile.x === general.x && tile.y === general.y;
            const armyThreshold = isGeneral ? 15 : 1;

            if (tile.army > armyThreshold && tile.army > bestArmy) {
                bestArmy = tile.army;
                bestTile = tile;
            }
        }

        if (!bestTile || bestTile.army <= 1) {
            // No good moves, wait for army to grow
            return;
        }

        // Decide action based on game state
        const action = this.decideAction(bestTile, myTiles);

        if (action.type === 'attack') {
            this.planAttack(bestTile, action.target);
        } else if (action.type === 'expand') {
            this.planExpansion(bestTile);
        } else if (action.type === 'consolidate') {
            this.planConsolidation(bestTile, myTiles);
        }
    }

    decideAction(sourceTile, myTiles) {
        const enemies = this.findVisibleEnemies();
        const neutralCities = this.findNeutralCities();
        const stats = this.game.getStats(this.playerNumber);

        // If we see an enemy general, attack it!
        const enemyGeneral = this.findEnemyGeneral();
        if (enemyGeneral) {
            return { type: 'attack', target: enemyGeneral };
        }

        // If we see enemy tiles, consider attacking
        if (enemies.length > 0 && sourceTile.army > 20) {
            // Find weakest enemy tile we can capture
            const weakest = enemies.reduce((best, e) =>
                (!best || e.army < best.army) ? e : best, null);

            if (weakest && sourceTile.army > weakest.army + 5) {
                return { type: 'attack', target: weakest };
            }
        }

        // Try to capture neutral cities
        if (neutralCities.length > 0 && sourceTile.army > 45) {
            const nearest = this.findNearest(sourceTile, neutralCities);
            if (nearest) {
                return { type: 'attack', target: nearest };
            }
        }

        // Expand if we have few tiles
        if (stats.land < 25 || Math.random() < 0.6) {
            return { type: 'expand' };
        }

        // Otherwise consolidate forces
        return { type: 'consolidate' };
    }

    planAttack(source, target) {
        const path = this.findPath(source, target);

        if (path && path.length > 1) {
            for (let i = 0; i < path.length - 1; i++) {
                this.moveQueue.push({
                    fromX: path[i].x,
                    fromY: path[i].y,
                    toX: path[i + 1].x,
                    toY: path[i + 1].y
                });
            }
        }
    }

    planExpansion(source) {
        // Find adjacent neutral tiles
        const directions = [
            { dx: 0, dy: -1 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
            { dx: 1, dy: 0 }
        ];

        // Prefer expanding towards center and unexplored areas
        const centerX = MAP_SIZE / 2;
        const centerY = MAP_SIZE / 2;

        let bestDir = null;
        let bestScore = -Infinity;

        for (const dir of directions) {
            const nx = source.x + dir.dx;
            const ny = source.y + dir.dy;
            const tile = this.game.getTile(nx, ny);

            if (!tile || tile.type === TILE.MOUNTAIN) continue;
            if (tile.owner === this.playerNumber) continue;

            // Can we capture this tile?
            if (tile.owner !== PLAYER.NONE || tile.type === TILE.CITY) {
                if (source.army <= tile.army + 1) continue;
            }

            // Score based on direction towards center and randomness
            let score = 0;
            score += (centerX - Math.abs(nx - centerX)) * 0.5;
            score += (centerY - Math.abs(ny - centerY)) * 0.5;
            score += Math.random() * 5;

            // Bonus for unexplored
            if (tile.owner === PLAYER.NONE) score += 3;

            if (score > bestScore) {
                bestScore = score;
                bestDir = dir;
            }
        }

        if (bestDir) {
            this.moveQueue.push({
                fromX: source.x,
                fromY: source.y,
                toX: source.x + bestDir.dx,
                toY: source.y + bestDir.dy
            });
        } else {
            // No expansion possible, try to move army towards frontier
            this.planConsolidation(source, this.getMyTiles());
        }
    }

    planConsolidation(source, myTiles) {
        // Move army towards the frontier (tiles adjacent to non-owned tiles)
        const frontier = myTiles.filter(t => this.isOnFrontier(t));

        if (frontier.length > 0 && !this.isOnFrontier(source)) {
            const target = frontier[Math.floor(Math.random() * frontier.length)];
            const path = this.findPath(source, target);

            if (path && path.length > 1) {
                this.moveQueue.push({
                    fromX: path[0].x,
                    fromY: path[0].y,
                    toX: path[1].x,
                    toY: path[1].y
                });
            }
        }
    }

    isOnFrontier(tile) {
        const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        for (const [dx, dy] of directions) {
            const neighbor = this.game.getTile(tile.x + dx, tile.y + dy);
            if (neighbor && neighbor.owner !== this.playerNumber && neighbor.type !== TILE.MOUNTAIN) {
                return true;
            }
        }

        return false;
    }

    getMyTiles() {
        const tiles = [];

        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const tile = this.game.getTile(x, y);
                if (tile.owner === this.playerNumber) {
                    tiles.push({ x, y, ...tile });
                }
            }
        }

        return tiles;
    }

    findVisibleEnemies() {
        const enemies = [];

        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const tile = this.game.getTile(x, y);
                if (tile.owner === this.opponent) {
                    enemies.push({ x, y, ...tile });
                }
            }
        }

        return enemies;
    }

    findEnemyGeneral() {
        const enemyGen = this.game.generals[this.opponent];
        const tile = this.game.getTile(enemyGen.x, enemyGen.y);

        // AI can see the whole map (knows general location)
        // But only attacks if it has a path
        return { x: enemyGen.x, y: enemyGen.y, ...tile };
    }

    findNeutralCities() {
        const cities = [];

        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const tile = this.game.getTile(x, y);
                if (tile.type === TILE.CITY && tile.owner === PLAYER.NONE) {
                    cities.push({ x, y, ...tile });
                }
            }
        }

        return cities;
    }

    findNearest(source, targets) {
        let nearest = null;
        let nearestDist = Infinity;

        for (const target of targets) {
            const dist = this.game.distance(source.x, source.y, target.x, target.y);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = target;
            }
        }

        return nearest;
    }

    findPath(start, end) {
        // Simple A* pathfinding
        const openSet = [{ x: start.x, y: start.y, g: 0, h: this.heuristic(start, end), path: [start] }];
        const closedSet = new Set();

        while (openSet.length > 0) {
            // Sort by f = g + h
            openSet.sort((a, b) => (a.g + a.h) - (b.g + b.h));
            const current = openSet.shift();

            if (current.x === end.x && current.y === end.y) {
                return current.path;
            }

            const key = `${current.x},${current.y}`;
            if (closedSet.has(key)) continue;
            closedSet.add(key);

            const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];

            for (const [dx, dy] of directions) {
                const nx = current.x + dx;
                const ny = current.y + dy;
                const nKey = `${nx},${ny}`;

                if (closedSet.has(nKey)) continue;

                const tile = this.game.getTile(nx, ny);
                if (!tile || tile.type === TILE.MOUNTAIN) continue;

                // Cost is higher for enemy tiles
                let cost = 1;
                if (tile.owner !== this.playerNumber && tile.owner !== PLAYER.NONE) {
                    cost += tile.army * 0.1;
                }

                const newPath = [...current.path, { x: nx, y: ny }];
                openSet.push({
                    x: nx,
                    y: ny,
                    g: current.g + cost,
                    h: this.heuristic({ x: nx, y: ny }, end),
                    path: newPath
                });
            }
        }

        return null; // No path found
    }

    heuristic(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
}
