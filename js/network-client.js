/**
 * Client-side Network Manager
 * Handles communication with the physics server
 */

import { CONFIG } from '../shared/config.js';

export class NetworkClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.clientId = null;
        this.connected = false;
        this.connecting = false;

        // Server configuration (received on connect)
        this.serverConfig = null;
        this.tickRate = 30;

        // Timing
        this.serverTimeOffset = 0;
        this.latency = 0;
        this.lastPingTime = 0;
        this.pingInterval = null;

        // Input sequencing
        this.inputSequence = 0;
        this.lastAckedInputSeq = 0;
        this.pendingInputs = [];

        // State interpolation
        this.snapshotBuffer = [];
        this.interpolationDelay = CONFIG.network.interpolationDelay;

        // Event handlers
        this.eventHandlers = new Map();

        // Chunk tracking
        this.requestedChunks = new Set();
        this.receivedChunks = new Map();
    }

    /**
     * Connect to server
     */
    connect(username, appearance) {
        if (this.connecting || this.connected) return;
        this.connecting = true;

        console.log('[Network] Connecting to', this.serverUrl);

        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
            console.log('[Network] Connected');
            this.connected = true;
            this.connecting = false;

            // Start ping interval
            this.pingInterval = setInterval(() => this.sendPing(), 2000);

            // Store credentials for handshake
            this.pendingUsername = username;
            this.pendingAppearance = appearance;
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (e) {
                console.error('[Network] Invalid message:', e);
            }
        };

        this.ws.onclose = () => {
            console.log('[Network] Disconnected');
            this.connected = false;
            this.connecting = false;
            this.cleanup();
            this.emit('disconnected');
        };

        this.ws.onerror = (error) => {
            console.error('[Network] Error:', error);
            this.emit('error', error);
        };
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.cleanup();
        }
    }

    /**
     * Cleanup on disconnect
     */
    cleanup() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.clientId = null;
        this.snapshotBuffer = [];
        this.pendingInputs = [];
        this.requestedChunks.clear();
    }

    /**
     * Handle incoming message
     */
    handleMessage(message) {
        const MT = CONFIG.messageTypes;

        switch (message.type) {
            case MT.HANDSHAKE_ACK:
                this.handleHandshakeAck(message);
                break;

            case MT.PONG:
                this.handlePong(message);
                break;

            case MT.WORLD_SNAPSHOT:
                this.handleWorldSnapshot(message);
                break;

            case MT.INPUT_ACK:
                this.handleInputAck(message);
                break;

            case MT.ENTITY_SPAWN:
                this.emit('entitySpawn', message);
                break;

            case MT.ENTITY_DESTROY:
                this.emit('entityDestroy', message);
                break;

            case MT.VEHICLE_ENTER:
                this.emit('vehicleEnter', message);
                break;

            case MT.VEHICLE_EXIT:
                this.emit('vehicleExit', message);
                break;

            case MT.CHUNK_DATA:
                this.handleChunkData(message);
                break;

            case MT.CHAT_MESSAGE:
                this.emit('chatMessage', message);
                break;

            case MT.GAME_EVENT:
                this.emit('gameEvent', message);
                break;
        }
    }

    /**
     * Handle handshake acknowledgment
     */
    handleHandshakeAck(message) {
        this.clientId = message.clientId;
        this.serverConfig = message.config;
        this.tickRate = message.tickRate;

        // Calculate initial time offset
        this.serverTimeOffset = message.serverTime - Date.now();

        console.log('[Network] Handshake complete, clientId:', this.clientId);

        // Send player spawn request
        this.send({
            type: CONFIG.messageTypes.HANDSHAKE,
            username: this.pendingUsername || 'Player',
            appearance: this.pendingAppearance || {}
        });

        this.emit('connected', {
            clientId: this.clientId,
            config: this.serverConfig
        });
    }

    /**
     * Handle pong response
     */
    handlePong(message) {
        const now = Date.now();
        this.latency = (now - message.clientTime) / 2;
        this.serverTimeOffset = message.serverTime - now + this.latency;

        this.emit('latencyUpdate', this.latency);
    }

    /**
     * Handle world snapshot
     */
    handleWorldSnapshot(message) {
        // Add to snapshot buffer
        this.snapshotBuffer.push({
            tick: message.tick,
            serverTime: message.serverTime,
            clientTime: Date.now(),
            players: message.players,
            vehicles: message.vehicles
        });

        // Keep buffer size limited
        while (this.snapshotBuffer.length > CONFIG.network.snapshotBufferSize) {
            this.snapshotBuffer.shift();
        }

        // Update last acked input
        if (message.yourLastInputSeq !== undefined) {
            this.lastAckedInputSeq = message.yourLastInputSeq;

            // Remove acked inputs from pending
            this.pendingInputs = this.pendingInputs.filter(
                input => input.seq > this.lastAckedInputSeq
            );
        }

        this.emit('worldSnapshot', message);
    }

    /**
     * Handle input acknowledgment
     */
    handleInputAck(message) {
        this.lastAckedInputSeq = Math.max(this.lastAckedInputSeq, message.seq);

        // Remove acked inputs
        this.pendingInputs = this.pendingInputs.filter(
            input => input.seq > this.lastAckedInputSeq
        );
    }

    /**
     * Handle chunk data
     */
    handleChunkData(message) {
        const key = `${message.chunkX},${message.chunkZ}`;
        this.requestedChunks.delete(key);
        this.receivedChunks.set(key, message);

        this.emit('chunkData', message);
    }

    /**
     * Send player input
     */
    sendPlayerInput(input) {
        if (!this.connected) return;

        // Increment sequence
        this.inputSequence++;
        input.seq = this.inputSequence;

        // Store for prediction reconciliation
        this.pendingInputs.push({ ...input, timestamp: Date.now() });

        // Keep pending inputs limited
        while (this.pendingInputs.length > CONFIG.network.inputBufferSize) {
            this.pendingInputs.shift();
        }

        this.send({
            type: CONFIG.messageTypes.PLAYER_INPUT,
            input
        });

        return input.seq;
    }

    /**
     * Send vehicle input
     */
    sendVehicleInput(input) {
        if (!this.connected) return;

        this.send({
            type: CONFIG.messageTypes.VEHICLE_INPUT,
            input
        });
    }

    /**
     * Request to enter nearest vehicle
     */
    requestEnterVehicle() {
        if (!this.connected) return;

        this.send({
            type: CONFIG.messageTypes.VEHICLE_ENTER
        });
    }

    /**
     * Request to exit current vehicle
     */
    requestExitVehicle() {
        if (!this.connected) return;

        this.send({
            type: CONFIG.messageTypes.VEHICLE_EXIT
        });
    }

    /**
     * Request chunk data
     */
    requestChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        if (this.requestedChunks.has(key) || this.receivedChunks.has(key)) {
            return;
        }

        this.requestedChunks.add(key);

        this.send({
            type: CONFIG.messageTypes.CHUNK_REQUEST,
            chunkX,
            chunkZ
        });
    }

    /**
     * Send chat message
     */
    sendChatMessage(message) {
        if (!this.connected) return;

        this.send({
            type: CONFIG.messageTypes.CHAT_MESSAGE,
            message
        });
    }

    /**
     * Send ping
     */
    sendPing() {
        if (!this.connected) return;

        this.lastPingTime = Date.now();
        this.send({
            type: CONFIG.messageTypes.PING,
            clientTime: this.lastPingTime
        });
    }

    /**
     * Send message to server
     */
    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    /**
     * Get interpolated state for rendering
     */
    getInterpolatedState(entityId, currentTime) {
        if (this.snapshotBuffer.length < 2) {
            return null;
        }

        // Target render time (in the past for interpolation)
        const renderTime = currentTime - this.interpolationDelay;

        // Find two snapshots to interpolate between
        let older = null;
        let newer = null;

        for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
            const snapshot = this.snapshotBuffer[i];
            const nextSnapshot = this.snapshotBuffer[i + 1];

            const snapshotTime = snapshot.clientTime;
            const nextTime = nextSnapshot.clientTime;

            if (snapshotTime <= renderTime && nextTime >= renderTime) {
                older = snapshot;
                newer = nextSnapshot;
                break;
            }
        }

        if (!older || !newer) {
            // Use most recent snapshot
            const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1];
            return this.findEntityInSnapshot(latest, entityId);
        }

        // Calculate interpolation factor
        const timeDiff = newer.clientTime - older.clientTime;
        const t = timeDiff > 0 ? (renderTime - older.clientTime) / timeDiff : 0;

        // Find entity in both snapshots
        const olderEntity = this.findEntityInSnapshot(older, entityId);
        const newerEntity = this.findEntityInSnapshot(newer, entityId);

        if (!olderEntity || !newerEntity) {
            return newerEntity || olderEntity;
        }

        // Interpolate position
        return {
            ...newerEntity,
            position: {
                x: this.lerp(olderEntity.position.x, newerEntity.position.x, t),
                y: this.lerp(olderEntity.position.y, newerEntity.position.y, t),
                z: this.lerp(olderEntity.position.z, newerEntity.position.z, t)
            },
            rotation: this.slerpQuaternion(olderEntity.rotation, newerEntity.rotation, t)
        };
    }

    /**
     * Find entity in snapshot
     */
    findEntityInSnapshot(snapshot, entityId) {
        // Check players
        const player = snapshot.players.find(p => p.entityId === entityId);
        if (player) return player;

        // Check vehicles
        const vehicle = snapshot.vehicles.find(v => v.entityId === entityId);
        if (vehicle) return vehicle;

        return null;
    }

    /**
     * Get latest snapshot
     */
    getLatestSnapshot() {
        if (this.snapshotBuffer.length === 0) return null;
        return this.snapshotBuffer[this.snapshotBuffer.length - 1];
    }

    /**
     * Get pending inputs for prediction reconciliation
     */
    getPendingInputs() {
        return this.pendingInputs;
    }

    /**
     * Check if chunk data is available
     */
    hasChunkData(chunkX, chunkZ) {
        return this.receivedChunks.has(`${chunkX},${chunkZ}`);
    }

    /**
     * Get chunk data
     */
    getChunkData(chunkX, chunkZ) {
        return this.receivedChunks.get(`${chunkX},${chunkZ}`);
    }

    /**
     * Clear old chunk data
     */
    clearOldChunks(keepKeys) {
        const keepSet = new Set(keepKeys);
        for (const key of this.receivedChunks.keys()) {
            if (!keepSet.has(key)) {
                this.receivedChunks.delete(key);
            }
        }
    }

    /**
     * Event handling
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    off(event, handler) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
    }

    emit(event, data) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => handler(data));
        }
    }

    /**
     * Linear interpolation
     */
    lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /**
     * Quaternion spherical interpolation (simplified)
     */
    slerpQuaternion(q1, q2, t) {
        if (!q1 || !q2) return q2 || q1;

        // Simple lerp for small angles (good enough for most cases)
        let dot = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;

        // Handle negative dot (take shorter path)
        let q2Modified = q2;
        if (dot < 0) {
            q2Modified = { x: -q2.x, y: -q2.y, z: -q2.z, w: -q2.w };
            dot = -dot;
        }

        // Linear interpolation for small angles
        if (dot > 0.9995) {
            return {
                x: this.lerp(q1.x, q2Modified.x, t),
                y: this.lerp(q1.y, q2Modified.y, t),
                z: this.lerp(q1.z, q2Modified.z, t),
                w: this.lerp(q1.w, q2Modified.w, t)
            };
        }

        // Spherical interpolation
        const theta0 = Math.acos(dot);
        const theta = theta0 * t;
        const sinTheta = Math.sin(theta);
        const sinTheta0 = Math.sin(theta0);

        const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
        const s1 = sinTheta / sinTheta0;

        return {
            x: s0 * q1.x + s1 * q2Modified.x,
            y: s0 * q1.y + s1 * q2Modified.y,
            z: s0 * q1.z + s1 * q2Modified.z,
            w: s0 * q1.w + s1 * q2Modified.w
        };
    }

    /**
     * Get server time estimate
     */
    getServerTime() {
        return Date.now() + this.serverTimeOffset;
    }

    /**
     * Get latency
     */
    getLatency() {
        return this.latency;
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.connected;
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.NetworkClient = NetworkClient;
}
