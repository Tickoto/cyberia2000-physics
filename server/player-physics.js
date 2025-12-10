/**
 * Server-side Player Physics System
 * Handles player movement, jumping, and collision with Rapier physics
 */

const CONFIG = require('../shared/config.js');

class PlayerPhysicsManager {
    constructor(physicsWorld, terrainManager) {
        this.physicsWorld = physicsWorld;
        this.terrainManager = terrainManager;

        // Player tracking
        this.players = new Map();        // entityId -> player data
        this.playerInputs = new Map();   // entityId -> current input state
        this.inputHistory = new Map();   // entityId -> input history for reconciliation

        // Configuration
        this.movementConfig = CONFIG.movement;
        this.physicsConfig = CONFIG.physics.player;
    }

    /**
     * Spawn a player
     */
    spawnPlayer(clientId, position, username = 'Player', appearance = {}) {
        const entityId = `player_${clientId}`;

        // Ensure terrain is loaded at spawn position
        this.terrainManager.forceLoadAroundPosition(position.x, position.z, 1);

        // Adjust position to be on ground
        const groundHeight = this.terrainManager.getHeightAt(position.x, position.z);
        position.y = Math.max(position.y, groundHeight + this.physicsConfig.height / 2 + 0.1);

        // Create physics body
        this.physicsWorld.createPlayerBody(entityId, position, clientId);

        // Store player data
        this.players.set(entityId, {
            entityId,
            clientId,
            username,
            appearance,
            health: 100,
            stamina: this.movementConfig.maxStamina,
            isRunning: false,
            isCrouching: false,
            yaw: 0,           // Horizontal look direction
            vehicleId: null,  // If in a vehicle
            lastInputSeq: 0   // Last processed input sequence
        });

        // Initialize input state
        this.playerInputs.set(entityId, {
            forward: 0,
            right: 0,
            jump: false,
            run: false,
            crouch: false,
            yaw: 0,
            seq: 0
        });

        // Initialize input history
        this.inputHistory.set(entityId, []);

        console.log(`[PlayerPhysics] Spawned player ${username} (${clientId}) at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
        return entityId;
    }

    /**
     * Remove a player
     */
    removePlayer(clientId) {
        const entityId = `player_${clientId}`;
        if (this.players.has(entityId)) {
            this.physicsWorld.removeEntity(entityId);
            this.players.delete(entityId);
            this.playerInputs.delete(entityId);
            this.inputHistory.delete(entityId);
            console.log(`[PlayerPhysics] Removed player: ${clientId}`);
        }
    }

    /**
     * Set player input from client
     */
    setPlayerInput(clientId, input) {
        const entityId = `player_${clientId}`;
        const player = this.players.get(entityId);
        if (!player) return;

        // Don't process if in vehicle
        if (player.vehicleId !== null) return;

        // Store input
        this.playerInputs.set(entityId, input);

        // Update yaw
        player.yaw = input.yaw;

        // Store in history for client reconciliation
        const history = this.inputHistory.get(entityId);
        if (history) {
            history.push({
                seq: input.seq,
                input: { ...input },
                timestamp: Date.now()
            });

            // Keep history limited
            while (history.length > CONFIG.network.inputBufferSize) {
                history.shift();
            }
        }
    }

    /**
     * Update all player physics
     */
    update(deltaTime) {
        for (const [entityId, player] of this.players) {
            // Skip if in vehicle
            if (player.vehicleId !== null) continue;

            const input = this.playerInputs.get(entityId);
            if (!input) continue;

            this.updatePlayerMovement(entityId, player, input, deltaTime);
        }
    }

    /**
     * Update single player movement
     */
    updatePlayerMovement(entityId, player, input, deltaTime) {
        const body = this.physicsWorld.bodies.get(entityId);
        const entityData = this.physicsWorld.entityData.get(entityId);
        if (!body || !entityData) return;

        // Update grounded state
        this.physicsWorld.updatePlayerGrounded(entityId);
        const isGrounded = entityData.grounded;

        // Get current state
        const pos = body.translation();
        const vel = body.linvel();

        // Calculate movement direction (based on player yaw)
        const yaw = player.yaw;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);

        // Forward and right vectors (horizontal plane)
        const forwardX = -sin;
        const forwardZ = -cos;
        const rightX = cos;
        const rightZ = -sin;

        // Desired movement direction
        let moveX = input.forward * forwardX + input.right * rightX;
        let moveZ = input.forward * forwardZ + input.right * rightZ;

        // Normalize if moving diagonally
        const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (moveLen > 1) {
            moveX /= moveLen;
            moveZ /= moveLen;
        }

        // Determine movement speed
        player.isRunning = input.run && player.stamina > 0;
        player.isCrouching = input.crouch;

        let targetSpeed;
        if (player.isCrouching) {
            targetSpeed = this.movementConfig.crouchSpeed;
        } else if (player.isRunning) {
            targetSpeed = this.movementConfig.runSpeed;
        } else {
            targetSpeed = this.movementConfig.walkSpeed;
        }

        // Calculate target velocity
        const targetVelX = moveX * targetSpeed;
        const targetVelZ = moveZ * targetSpeed;

        // Apply movement (different acceleration on ground vs air)
        const accel = isGrounded ? 20 : 20 * this.movementConfig.airControl;

        const newVelX = this.approach(vel.x, targetVelX, accel * deltaTime);
        const newVelZ = this.approach(vel.z, targetVelZ, accel * deltaTime);

        // Handle jumping
        let newVelY = vel.y;
        if (input.jump && isGrounded && !player.isCrouching) {
            newVelY = this.movementConfig.jumpForce;
            // Small horizontal boost in movement direction
            // newVelX += moveX * 2;
            // newVelZ += moveZ * 2;
        }

        // Apply velocity
        this.physicsWorld.setVelocity(entityId, {
            x: newVelX,
            y: newVelY,
            z: newVelZ
        });

        // Update stamina
        if (player.isRunning && moveLen > 0) {
            player.stamina = Math.max(0, player.stamina - this.movementConfig.staminaDrainRate * deltaTime);
        } else if (!player.isRunning) {
            player.stamina = Math.min(
                this.movementConfig.maxStamina,
                player.stamina + this.movementConfig.staminaRegenRate * deltaTime
            );
        }

        // Update last processed input sequence
        player.lastInputSeq = input.seq;

        // Prevent falling through terrain (safety check)
        const groundHeight = this.terrainManager.getHeightAt(pos.x, pos.z);
        const minY = groundHeight + this.physicsConfig.height / 2;
        if (pos.y < minY - 1) {
            this.physicsWorld.setPosition(entityId, { x: pos.x, y: minY, z: pos.z });
            this.physicsWorld.setVelocity(entityId, { x: newVelX, y: 0, z: newVelZ });
        }
    }

    /**
     * Move value toward target at rate
     */
    approach(current, target, rate) {
        if (current < target) {
            return Math.min(current + rate, target);
        } else if (current > target) {
            return Math.max(current - rate, target);
        }
        return target;
    }

    /**
     * Player enters vehicle
     */
    playerEnterVehicle(clientId, vehicleId) {
        const entityId = `player_${clientId}`;
        const player = this.players.get(entityId);
        if (!player) return false;

        player.vehicleId = vehicleId;

        // Disable player physics body (but keep it for later)
        const body = this.physicsWorld.bodies.get(entityId);
        if (body) {
            body.setEnabled(false);
        }

        return true;
    }

    /**
     * Player exits vehicle
     */
    playerExitVehicle(clientId, exitPosition) {
        const entityId = `player_${clientId}`;
        const player = this.players.get(entityId);
        if (!player || player.vehicleId === null) return false;

        player.vehicleId = null;

        // Re-enable and reposition player physics body
        const body = this.physicsWorld.bodies.get(entityId);
        if (body) {
            body.setEnabled(true);

            // Adjust position to be on ground
            const groundHeight = this.terrainManager.getHeightAt(exitPosition.x, exitPosition.z);
            exitPosition.y = Math.max(exitPosition.y, groundHeight + this.physicsConfig.height / 2 + 0.1);

            this.physicsWorld.setPosition(entityId, exitPosition);
            this.physicsWorld.setVelocity(entityId, { x: 0, y: 0, z: 0 });
        }

        return true;
    }

    /**
     * Teleport player to position
     */
    teleportPlayer(clientId, position) {
        const entityId = `player_${clientId}`;
        if (!this.players.has(entityId)) return false;

        // Ensure terrain is loaded
        this.terrainManager.forceLoadAroundPosition(position.x, position.z, 1);

        // Adjust position to be on ground
        const groundHeight = this.terrainManager.getHeightAt(position.x, position.z);
        position.y = Math.max(position.y, groundHeight + this.physicsConfig.height / 2 + 0.1);

        this.physicsWorld.setPosition(entityId, position);
        this.physicsWorld.setVelocity(entityId, { x: 0, y: 0, z: 0 });

        return true;
    }

    /**
     * Apply damage to player
     */
    damagePlayer(clientId, damage) {
        const entityId = `player_${clientId}`;
        const player = this.players.get(entityId);
        if (!player) return false;

        player.health = Math.max(0, player.health - damage);

        if (player.health <= 0) {
            // Player died - could trigger respawn logic
            console.log(`[PlayerPhysics] Player ${player.username} died`);
        }

        return player.health;
    }

    /**
     * Heal player
     */
    healPlayer(clientId, amount) {
        const entityId = `player_${clientId}`;
        const player = this.players.get(entityId);
        if (!player) return false;

        player.health = Math.min(100, player.health + amount);
        return player.health;
    }

    /**
     * Get player state for networking
     */
    getPlayerState(clientId) {
        const entityId = `player_${clientId}`;
        const player = this.players.get(entityId);
        if (!player) return null;

        // If in vehicle, return vehicle-attached state
        if (player.vehicleId !== null) {
            return {
                entityId,
                clientId: player.clientId,
                type: CONFIG.entityTypes.PLAYER,
                inVehicle: true,
                vehicleId: player.vehicleId,
                username: player.username,
                appearance: player.appearance,
                health: player.health,
                stamina: player.stamina,
                lastInputSeq: player.lastInputSeq
            };
        }

        const physicsState = this.physicsWorld.getEntityState(entityId);
        if (!physicsState) return null;

        return {
            ...physicsState,
            clientId: player.clientId,
            username: player.username,
            appearance: player.appearance,
            health: player.health,
            stamina: player.stamina,
            yaw: player.yaw,
            isRunning: player.isRunning,
            isCrouching: player.isCrouching,
            inVehicle: false,
            vehicleId: null,
            lastInputSeq: player.lastInputSeq
        };
    }

    /**
     * Get all player states
     */
    getAllPlayerStates() {
        const states = [];
        for (const player of this.players.values()) {
            const state = this.getPlayerState(player.clientId);
            if (state) states.push(state);
        }
        return states;
    }

    /**
     * Get player positions for terrain loading
     */
    getPlayerPositions() {
        const positions = [];
        for (const [entityId, player] of this.players) {
            if (player.vehicleId !== null) continue; // Skip players in vehicles

            const state = this.physicsWorld.getEntityState(entityId);
            if (state) {
                positions.push({
                    entityId,
                    x: state.position.x,
                    z: state.position.z
                });
            }
        }
        return positions;
    }

    /**
     * Get player by client ID
     */
    getPlayer(clientId) {
        return this.players.get(`player_${clientId}`);
    }

    /**
     * Check if client has a player
     */
    hasPlayer(clientId) {
        return this.players.has(`player_${clientId}`);
    }

    /**
     * Get player count
     */
    getPlayerCount() {
        return this.players.size;
    }

    /**
     * Update player appearance
     */
    updatePlayerAppearance(clientId, appearance) {
        const entityId = `player_${clientId}`;
        const player = this.players.get(entityId);
        if (player) {
            player.appearance = { ...player.appearance, ...appearance };
        }
    }

    /**
     * Update player username
     */
    updatePlayerUsername(clientId, username) {
        const entityId = `player_${clientId}`;
        const player = this.players.get(entityId);
        if (player) {
            player.username = username;
        }
    }
}

module.exports = PlayerPhysicsManager;
