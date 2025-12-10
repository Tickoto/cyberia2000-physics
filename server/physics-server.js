/**
 * Main Physics Server
 * Server-authoritative networked physics with Rapier
 */

const WebSocket = require('ws');
const CONFIG = require('../shared/config.js');
const PhysicsWorld = require('./physics-world.js');
const TerrainPhysicsManager = require('./terrain-physics.js');
const VehiclePhysicsManager = require('./vehicle-physics.js');
const PlayerPhysicsManager = require('./player-physics.js');

class PhysicsServer {
    constructor(port = CONFIG.network.port) {
        this.port = port;
        this.wss = null;

        // Managers
        this.physicsWorld = null;
        this.terrainManager = null;
        this.vehicleManager = null;
        this.playerManager = null;

        // Client tracking
        this.clients = new Map();        // ws -> clientData
        this.clientsById = new Map();    // clientId -> ws

        // Game state
        this.tickNumber = 0;
        this.lastTickTime = 0;
        this.tickInterval = null;

        // Chunk requests
        this.chunkRequestQueue = new Map(); // clientId -> Set of chunk keys

        // Message handlers
        this.messageHandlers = new Map();
        this.setupMessageHandlers();
    }

    /**
     * Initialize and start the server
     */
    async start() {
        console.log('[Server] Initializing Rapier physics...');

        // Initialize physics world
        this.physicsWorld = new PhysicsWorld();
        await this.physicsWorld.init();

        // Initialize managers
        this.terrainManager = new TerrainPhysicsManager(this.physicsWorld);
        this.vehicleManager = new VehiclePhysicsManager(this.physicsWorld, this.terrainManager);
        this.playerManager = new PlayerPhysicsManager(this.physicsWorld, this.terrainManager);

        // Spawn some initial vehicles
        this.spawnInitialVehicles();

        // Start WebSocket server
        this.wss = new WebSocket.Server({ port: this.port });
        this.setupWebSocket();

        // Start game loop
        this.startGameLoop();

        console.log(`[Server] Physics server running on port ${this.port}`);
        console.log(`[Server] Tick rate: ${CONFIG.network.tickRate} Hz`);
    }

    /**
     * Setup WebSocket event handlers
     */
    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            this.handleConnection(ws);
        });

        this.wss.on('error', (error) => {
            console.error('[Server] WebSocket error:', error);
        });
    }

    /**
     * Handle new client connection
     */
    handleConnection(ws) {
        const clientId = this.generateClientId();

        const clientData = {
            clientId,
            ws,
            username: 'Player',
            state: 'connected',
            lastPing: Date.now(),
            latency: 0,
            chunkRequests: new Set()
        };

        this.clients.set(ws, clientData);
        this.clientsById.set(clientId, ws);

        console.log(`[Server] Client connected: ${clientId}`);

        // Setup message handler
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                this.handleMessage(ws, message);
            } catch (e) {
                console.error('[Server] Invalid message:', e);
            }
        });

        ws.on('close', () => {
            this.handleDisconnect(ws);
        });

        ws.on('error', (error) => {
            console.error(`[Server] Client error (${clientId}):`, error);
        });

        // Send handshake acknowledgment
        this.send(ws, {
            type: CONFIG.messageTypes.HANDSHAKE_ACK,
            clientId,
            serverTime: Date.now(),
            tickRate: CONFIG.network.tickRate,
            config: {
                world: CONFIG.world,
                physics: {
                    gravity: CONFIG.physics.gravity,
                    player: CONFIG.physics.player
                },
                movement: CONFIG.movement
            }
        });
    }

    /**
     * Handle client disconnect
     */
    handleDisconnect(ws) {
        const clientData = this.clients.get(ws);
        if (!clientData) return;

        const { clientId } = clientData;
        console.log(`[Server] Client disconnected: ${clientId}`);

        // Remove player from physics
        this.playerManager.removePlayer(clientId);

        // Exit any vehicle
        const vehicleId = this.vehicleManager.getVehicleByDriver(clientId);
        if (vehicleId) {
            this.vehicleManager.exitVehicle(vehicleId, clientId);
        }

        // Cleanup
        this.clients.delete(ws);
        this.clientsById.delete(clientId);
        this.chunkRequestQueue.delete(clientId);

        // Notify other clients
        this.broadcast({
            type: CONFIG.messageTypes.ENTITY_DESTROY,
            entityId: `player_${clientId}`
        }, ws);
    }

    /**
     * Setup message handlers
     */
    setupMessageHandlers() {
        const MT = CONFIG.messageTypes;

        this.messageHandlers.set(MT.HANDSHAKE, this.handleHandshake.bind(this));
        this.messageHandlers.set(MT.PING, this.handlePing.bind(this));
        this.messageHandlers.set(MT.PLAYER_INPUT, this.handlePlayerInput.bind(this));
        this.messageHandlers.set(MT.VEHICLE_INPUT, this.handleVehicleInput.bind(this));
        this.messageHandlers.set(MT.VEHICLE_ENTER, this.handleVehicleEnter.bind(this));
        this.messageHandlers.set(MT.VEHICLE_EXIT, this.handleVehicleExit.bind(this));
        this.messageHandlers.set(MT.CHUNK_REQUEST, this.handleChunkRequest.bind(this));
        this.messageHandlers.set(MT.CHAT_MESSAGE, this.handleChatMessage.bind(this));
    }

    /**
     * Handle incoming message
     */
    handleMessage(ws, message) {
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
            handler(ws, message);
        } else {
            console.warn(`[Server] Unknown message type: ${message.type}`);
        }
    }

    /**
     * Handle handshake (player spawn)
     */
    handleHandshake(ws, message) {
        const clientData = this.clients.get(ws);
        if (!clientData) return;

        const { username, appearance } = message;
        clientData.username = username || 'Player';
        clientData.state = 'playing';

        // Find spawn point
        const spawnPoint = this.terrainManager.findSpawnPoint();

        // Spawn player
        this.playerManager.spawnPlayer(
            clientData.clientId,
            spawnPoint,
            clientData.username,
            appearance || {}
        );

        // Send spawn confirmation
        this.send(ws, {
            type: CONFIG.messageTypes.ENTITY_SPAWN,
            entityId: `player_${clientData.clientId}`,
            entityType: CONFIG.entityTypes.PLAYER,
            position: spawnPoint,
            isLocal: true
        });

        // Notify other clients of new player
        this.broadcast({
            type: CONFIG.messageTypes.ENTITY_SPAWN,
            entityId: `player_${clientData.clientId}`,
            entityType: CONFIG.entityTypes.PLAYER,
            position: spawnPoint,
            username: clientData.username,
            appearance: appearance || {},
            isLocal: false
        }, ws);

        // Send existing players to new client
        for (const [otherWs, otherData] of this.clients) {
            if (otherWs !== ws && otherData.state === 'playing') {
                const playerState = this.playerManager.getPlayerState(otherData.clientId);
                if (playerState) {
                    this.send(ws, {
                        type: CONFIG.messageTypes.ENTITY_SPAWN,
                        ...playerState,
                        isLocal: false
                    });
                }
            }
        }

        // Send existing vehicles to new client
        for (const vehicleState of this.vehicleManager.getAllVehicleStates()) {
            this.send(ws, {
                type: CONFIG.messageTypes.ENTITY_SPAWN,
                ...vehicleState,
                entityType: CONFIG.entityTypes.VEHICLE
            });
        }

        console.log(`[Server] Player ${clientData.username} spawned at (${spawnPoint.x.toFixed(1)}, ${spawnPoint.y.toFixed(1)}, ${spawnPoint.z.toFixed(1)})`);
    }

    /**
     * Handle ping
     */
    handlePing(ws, message) {
        const clientData = this.clients.get(ws);
        if (!clientData) return;

        clientData.lastPing = Date.now();

        this.send(ws, {
            type: CONFIG.messageTypes.PONG,
            clientTime: message.clientTime,
            serverTime: Date.now()
        });
    }

    /**
     * Handle player input
     */
    handlePlayerInput(ws, message) {
        const clientData = this.clients.get(ws);
        if (!clientData || clientData.state !== 'playing') return;

        this.playerManager.setPlayerInput(clientData.clientId, message.input);

        // Acknowledge input
        this.send(ws, {
            type: CONFIG.messageTypes.INPUT_ACK,
            seq: message.input.seq
        });
    }

    /**
     * Handle vehicle input
     */
    handleVehicleInput(ws, message) {
        const clientData = this.clients.get(ws);
        if (!clientData) return;

        const vehicleId = this.vehicleManager.getVehicleByDriver(clientData.clientId);
        if (vehicleId) {
            this.vehicleManager.setVehicleInput(vehicleId, message.input);
        }
    }

    /**
     * Handle vehicle enter request
     */
    handleVehicleEnter(ws, message) {
        const clientData = this.clients.get(ws);
        if (!clientData) return;

        const playerState = this.playerManager.getPlayerState(clientData.clientId);
        if (!playerState || playerState.inVehicle) return;

        // Find nearest vehicle
        const nearest = this.vehicleManager.findNearestVehicle(playerState.position, 5);
        if (nearest && !nearest.occupied) {
            // Enter vehicle
            if (this.vehicleManager.enterVehicle(nearest.entityId, clientData.clientId)) {
                this.playerManager.playerEnterVehicle(clientData.clientId, nearest.entityId);

                // Notify all clients
                this.broadcast({
                    type: CONFIG.messageTypes.VEHICLE_ENTER,
                    vehicleId: nearest.entityId,
                    playerId: clientData.clientId
                });
            }
        }
    }

    /**
     * Handle vehicle exit request
     */
    handleVehicleExit(ws, message) {
        const clientData = this.clients.get(ws);
        if (!clientData) return;

        const vehicleId = this.vehicleManager.getVehicleByDriver(clientData.clientId);
        if (!vehicleId) return;

        const vehicleState = this.vehicleManager.getVehicleState(vehicleId);
        if (!vehicleState) return;

        // Calculate exit position (beside vehicle)
        const exitOffset = 3;
        const exitPosition = {
            x: vehicleState.position.x + exitOffset,
            y: vehicleState.position.y,
            z: vehicleState.position.z
        };

        // Exit vehicle
        if (this.vehicleManager.exitVehicle(vehicleId, clientData.clientId)) {
            this.playerManager.playerExitVehicle(clientData.clientId, exitPosition);

            // Notify all clients
            this.broadcast({
                type: CONFIG.messageTypes.VEHICLE_EXIT,
                vehicleId: vehicleId,
                playerId: clientData.clientId,
                exitPosition
            });
        }
    }

    /**
     * Handle chunk data request
     */
    handleChunkRequest(ws, message) {
        const clientData = this.clients.get(ws);
        if (!clientData) return;

        const { chunkX, chunkZ } = message;
        const key = `${chunkX},${chunkZ}`;

        // Queue chunk request
        if (!clientData.chunkRequests.has(key)) {
            clientData.chunkRequests.add(key);
        }
    }

    /**
     * Handle chat message
     */
    handleChatMessage(ws, message) {
        const clientData = this.clients.get(ws);
        if (!clientData) return;

        // Broadcast chat message
        this.broadcast({
            type: CONFIG.messageTypes.CHAT_MESSAGE,
            clientId: clientData.clientId,
            username: clientData.username,
            message: message.message,
            timestamp: Date.now()
        });
    }

    /**
     * Start the game loop
     */
    startGameLoop() {
        const tickMs = 1000 / CONFIG.network.tickRate;
        this.lastTickTime = Date.now();

        this.tickInterval = setInterval(() => {
            this.tick();
        }, tickMs);
    }

    /**
     * Main game tick
     */
    tick() {
        const now = Date.now();
        const deltaTime = (now - this.lastTickTime) / 1000;
        this.lastTickTime = now;
        this.tickNumber++;

        // Update terrain based on player positions
        const playerPositions = this.playerManager.getPlayerPositions();
        this.terrainManager.updateForPlayers(playerPositions);

        // Update player physics
        this.playerManager.update(deltaTime);

        // Update vehicle physics
        this.vehicleManager.update(deltaTime);

        // Step physics world
        this.physicsWorld.step(deltaTime);

        // Process chunk requests
        this.processChunkRequests();

        // Send world snapshot
        this.sendWorldSnapshot();

        // Periodic status
        if (this.tickNumber % (CONFIG.network.tickRate * 30) === 0) {
            this.logStatus();
        }
    }

    /**
     * Process pending chunk requests
     */
    processChunkRequests() {
        const maxChunksPerTick = 2;

        for (const [ws, clientData] of this.clients) {
            let sent = 0;
            for (const key of clientData.chunkRequests) {
                if (sent >= maxChunksPerTick) break;

                const [chunkX, chunkZ] = key.split(',').map(Number);
                const chunkData = this.terrainManager.getChunkDataForClient(chunkX, chunkZ);

                this.send(ws, {
                    type: CONFIG.messageTypes.CHUNK_DATA,
                    ...chunkData
                });

                clientData.chunkRequests.delete(key);
                sent++;
            }
        }
    }

    /**
     * Send world snapshot to all clients
     */
    sendWorldSnapshot() {
        const playerStates = this.playerManager.getAllPlayerStates();
        const vehicleStates = this.vehicleManager.getAllVehicleStates();

        const snapshot = {
            type: CONFIG.messageTypes.WORLD_SNAPSHOT,
            tick: this.tickNumber,
            serverTime: Date.now(),
            players: playerStates,
            vehicles: vehicleStates
        };

        // Send to each client with their specific lastInputSeq
        for (const [ws, clientData] of this.clients) {
            if (clientData.state !== 'playing') continue;

            // Find this client's player state
            const myPlayerState = playerStates.find(p => p.clientId === clientData.clientId);

            this.send(ws, {
                ...snapshot,
                yourLastInputSeq: myPlayerState?.lastInputSeq || 0
            });
        }
    }

    /**
     * Spawn initial vehicles around spawn areas
     */
    spawnInitialVehicles() {
        // Wait a bit for terrain to initialize, then spawn vehicles
        setTimeout(() => {
            const vehicleTypes = ['car', 'car', 'truck', 'motorcycle', 'hovercraft', 'helicopter', 'tank'];

            // Spawn some vehicles at spawn point
            const spawnPoint = this.terrainManager.findSpawnPoint();

            for (let i = 0; i < vehicleTypes.length; i++) {
                const type = vehicleTypes[i];
                const angle = (i / vehicleTypes.length) * Math.PI * 2;
                const radius = 20 + i * 10;

                const x = spawnPoint.x + Math.cos(angle) * radius;
                const z = spawnPoint.z + Math.sin(angle) * radius;
                const y = this.terrainManager.getHeightAt(x, z) + 2;

                this.vehicleManager.spawnVehicle(type, { x, y, z }, angle);
            }

            console.log(`[Server] Spawned ${vehicleTypes.length} initial vehicles`);
        }, 1000);
    }

    /**
     * Log server status
     */
    logStatus() {
        const playerCount = this.playerManager.getPlayerCount();
        const vehicleCount = this.vehicleManager.vehicles.size;
        const chunkCount = this.terrainManager.loadedChunks.size;

        console.log(`[Server] Status - Players: ${playerCount}, Vehicles: ${vehicleCount}, Chunks: ${chunkCount}, Tick: ${this.tickNumber}`);
    }

    /**
     * Send message to client
     */
    send(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    /**
     * Broadcast message to all clients (optionally excluding one)
     */
    broadcast(message, excludeWs = null) {
        const data = JSON.stringify(message);
        for (const [ws] of this.clients) {
            if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        }
    }

    /**
     * Generate unique client ID
     */
    generateClientId() {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Stop the server
     */
    stop() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }

        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }

        if (this.physicsWorld) {
            this.physicsWorld.destroy();
            this.physicsWorld = null;
        }

        console.log('[Server] Physics server stopped');
    }
}

// Start server if run directly
if (require.main === module) {
    const server = new PhysicsServer();
    server.start().catch(console.error);

    // Handle shutdown
    process.on('SIGINT', () => {
        console.log('\n[Server] Shutting down...');
        server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        server.stop();
        process.exit(0);
    });
}

module.exports = PhysicsServer;
