/**
 * Client-side Player Controller with Prediction
 * Handles player input, rendering, and client-side prediction
 */

import { CONFIG } from '../shared/config.js';
import { Character } from './character.js';

export class PlayerController {
    constructor(scene, camera, networkClient, terrainRenderer) {
        this.scene = scene;
        this.camera = camera;
        this.networkClient = networkClient;
        this.terrainRenderer = terrainRenderer;

        // Player state
        this.entityId = null;
        this.clientId = null;
        this.position = new THREE.Vector3(0, 10, 0);
        this.velocity = new THREE.Vector3();
        this.yaw = 0;
        this.pitch = 0;

        // Predicted state (for smooth movement)
        this.predictedPosition = new THREE.Vector3();
        this.predictedVelocity = new THREE.Vector3();

        // Character mesh
        this.mesh = null;
        this.characterGroup = null;
        this.character = null;

        // Other players
        this.otherPlayers = new Map();  // entityId -> { mesh, state, smoothing }
        this.remoteSmoothingWindow = (CONFIG.networkInterpolationDelay || 100) / 1000;

        // Input state
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            run: false,
            crouch: false
        };

        // Mouse state
        this.mouseSensitivity = 0.002;
        this.pointerLocked = false;

        // Configuration
        this.config = CONFIG.movement;
        this.physicsConfig = CONFIG.physics.player;

        // Camera settings
        this.cameraOffset = new THREE.Vector3(0, 2, 5);
        this.cameraTarget = new THREE.Vector3();

        // Player state
        this.isGrounded = false;
        this.isRunning = false;
        this.isCrouching = false;
        this.stamina = this.config.maxStamina;
        this.health = 100;

        // In vehicle
        this.inVehicle = false;
        this.vehicleId = null;

        // Input sequence
        this.lastSentInput = null;

        // Setup controls
        this.setupControls();
    }

    /**
     * Setup keyboard and mouse controls
     */
    setupControls() {
        // Keyboard
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));

        // Mouse
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('click', () => this.requestPointerLock());

        // Pointer lock
        document.addEventListener('pointerlockchange', () => {
            this.pointerLocked = document.pointerLockElement !== null;
        });
    }

    /**
     * Request pointer lock for mouse control
     */
    requestPointerLock() {
        if (!this.pointerLocked && document.body.requestPointerLock) {
            document.body.requestPointerLock();
        }
    }

    /**
     * Handle key down
     */
    onKeyDown(e) {
        if (e.repeat) return;

        switch (e.code) {
            case 'KeyW': this.keys.forward = true; break;
            case 'KeyS': this.keys.backward = true; break;
            case 'KeyA': this.keys.left = true; break;
            case 'KeyD': this.keys.right = true; break;
            case 'Space': this.keys.jump = true; break;
            case 'ShiftLeft':
            case 'ShiftRight': this.keys.run = true; break;
            case 'ControlLeft':
            case 'ControlRight': this.keys.crouch = true; break;
            case 'KeyE': this.handleInteraction(); break;
            case 'KeyF': this.handleVehicleToggle(); break;
        }
    }

    /**
     * Handle key up
     */
    onKeyUp(e) {
        switch (e.code) {
            case 'KeyW': this.keys.forward = false; break;
            case 'KeyS': this.keys.backward = false; break;
            case 'KeyA': this.keys.left = false; break;
            case 'KeyD': this.keys.right = false; break;
            case 'Space': this.keys.jump = false; break;
            case 'ShiftLeft':
            case 'ShiftRight': this.keys.run = false; break;
            case 'ControlLeft':
            case 'ControlRight': this.keys.crouch = false; break;
        }
    }

    /**
     * Handle mouse move
     */
    onMouseMove(e) {
        if (!this.pointerLocked) return;

        this.yaw -= e.movementX * this.mouseSensitivity;
        this.pitch -= e.movementY * this.mouseSensitivity;

        // Clamp pitch
        this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
    }

    /**
     * Handle vehicle enter/exit
     */
    handleVehicleToggle() {
        if (this.inVehicle) {
            this.networkClient.requestExitVehicle();
        } else {
            this.networkClient.requestEnterVehicle();
        }
    }

    /**
     * Handle interaction (E key)
     */
    handleInteraction() {
        // TODO: Implement interaction system
        console.log('Interaction pressed');
    }

    /**
     * Initialize player (called when spawned)
     */
    initPlayer(entityId, clientId, position, appearance) {
        this.entityId = entityId;
        this.clientId = clientId;
        this.position.set(position.x, position.y, position.z);
        this.predictedPosition.copy(this.position);

        // Create character mesh using detailed renderer
        this.createCharacterMesh(appearance);

        console.log('[Player] Initialized at', position);
    }

    /**
     * Create character mesh
     */
    createCharacterMesh(appearance = {}) {
        const params = {
            gender: appearance.gender || 'female',
            height: appearance.height || 1.0,
            skin: `#${(appearance.skinColor || 0xffcc99).toString(16).padStart(6, '0')}`,
            hair: appearance.hairStyle ?? 2,
            hairColor: `#${(appearance.hairColor || 0xaa0000).toString(16).padStart(6, '0')}`,
            jacketColor: `#${(appearance.jacket || 0x111111).toString(16).padStart(6, '0')}`,
            shirtColor: `#${(appearance.shirt || 0x990000).toString(16).padStart(6, '0')}`,
            pantsColor: `#${(appearance.pants || 0x223355).toString(16).padStart(6, '0')}`
        };

        this.character = new Character(true);
        this.character.params = { ...this.character.params, ...params };
        this.character.rebuild();

        this.characterGroup = this.character.group;
        this.characterGroup.position.copy(this.position);
        this.scene.add(this.characterGroup);
        this.mesh = this.characterGroup;
    }

    /**
     * Spawn other player
     */
    spawnOtherPlayer(entityId, state) {
        if (this.otherPlayers.has(entityId)) return;

        const params = {
            gender: state.appearance?.gender || 'female',
            height: state.appearance?.height || 1.0,
            skin: `#${(state.appearance?.skinColor || 0xffcc99).toString(16).padStart(6, '0')}`,
            hair: state.appearance?.hairStyle ?? 2,
            hairColor: `#${(state.appearance?.hairColor || 0xaa0000).toString(16).padStart(6, '0')}`,
            jacketColor: `#${(state.appearance?.jacket || 0x111111).toString(16).padStart(6, '0')}`,
            shirtColor: `#${(state.appearance?.shirt || 0x990000).toString(16).padStart(6, '0')}`,
            pantsColor: `#${(state.appearance?.pants || 0x223355).toString(16).padStart(6, '0')}`
        };

        const character = new Character(false);
        character.params = { ...character.params, ...params };
        character.rebuild();

        character.group.position.set(state.position.x, state.position.y, state.position.z);
        character.group.rotation.y = state.yaw || 0;
        this.scene.add(character.group);

        this.otherPlayers.set(entityId, {
            mesh: character.group,
            character,
            state: state
        });
    }

    /**
     * Remove other player
     */
    removeOtherPlayer(entityId) {
        const player = this.otherPlayers.get(entityId);
        if (!player) return;

        this.scene.remove(player.mesh);
        player.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });

        this.otherPlayers.delete(entityId);
    }

    /**
     * Update from server state
     */
    updateFromServer(state) {
        if (state.entityId === this.entityId) {
            // Update local player
            this.updateLocalPlayerFromServer(state);
        } else {
            // Update other player
            this.updateOtherPlayerFromServer(state);
        }
    }

    /**
     * Update local player from server state
     */
    updateLocalPlayerFromServer(state) {
        // Update state
        this.health = state.health;
        this.stamina = state.stamina;
        this.isGrounded = state.grounded;
        this.inVehicle = state.inVehicle || false;
        this.vehicleId = state.vehicleId;

        // Reconciliation: compare server position with predicted
        const serverPos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
        const error = this.predictedPosition.distanceTo(serverPos);

        // If error is too large, snap to server position
        if (error > 2.0) {
            this.position.copy(serverPos);
            this.predictedPosition.copy(serverPos);
            this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
            this.predictedVelocity.copy(this.velocity);
        } else if (error > 0.1) {
            // Smooth correction
            this.position.lerp(serverPos, 0.3);
            this.predictedPosition.lerp(serverPos, 0.1);
        }

        // Re-apply unacknowledged inputs for prediction
        const pendingInputs = this.networkClient.getPendingInputs();
        for (const inputData of pendingInputs) {
            if (inputData.seq > state.lastInputSeq) {
                this.applyInput(inputData.input, 1 / 60);
            }
        }
    }

    /**
     * Update other player from server state
     */
    updateOtherPlayerFromServer(state) {
        let player = this.otherPlayers.get(state.entityId);

        if (!player) {
            this.spawnOtherPlayer(state.entityId, state);
            player = this.otherPlayers.get(state.entityId);
        }

        if (!player) return;

        const now = performance.now();
        const targetPos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
        const targetVel = new THREE.Vector3(state.velocity?.x || 0, state.velocity?.y || 0, state.velocity?.z || 0);

        player.smoothing = {
            from: player.mesh.position.clone(),
            to: targetPos,
            velocity: targetVel,
            start: now,
            duration: this.remoteSmoothingWindow * 1000
        };

        if (state.yaw !== undefined) {
            player.targetYaw = state.yaw;
        }

        player.state = state;
    }

    /**
     * Update (called each frame)
     */
    update(deltaTime) {
        if (!this.entityId) return;

        // Skip if in vehicle (but still smooth remote avatars)
        if (this.inVehicle) {
            this.updateInVehicle(deltaTime);
            this.smoothRemotePlayers(deltaTime);
            return;
        }

        // Build input
        const input = this.buildInput();

        // Apply input locally for prediction
        this.applyInput(input, deltaTime);

        // Send input to server
        this.networkClient.sendPlayerInput(input);

        // Update character mesh
        this.updateCharacterMesh();

        // Update camera
        this.updateCamera(deltaTime);

        // Smooth remote players after processing local movement
        this.smoothRemotePlayers(deltaTime);
    }

    smoothRemotePlayers(deltaTime) {
        const now = performance.now();
        for (const player of this.otherPlayers.values()) {
            if (!player.smoothing) continue;

            const t = Math.min(1, (now - player.smoothing.start) / player.smoothing.duration);
            const eased = t * t * (3 - 2 * t);

            const blended = new THREE.Vector3().copy(player.smoothing.to);
            // Add tiny extrapolation based on velocity to reduce end-of-window snapping
            blended.addScaledVector(player.smoothing.velocity, this.remoteSmoothingWindow * (1 - eased));

            player.mesh.position.lerpVectors(player.smoothing.from, blended, eased);

            if (player.targetYaw !== undefined) {
                player.mesh.rotation.y = THREE.MathUtils.lerp(player.mesh.rotation.y, player.targetYaw, 0.15);
            }

            if (player.character) {
                const speed = player.smoothing.velocity.length();
                player.character.animate(speed * 10);
            }
        }
    }

    /**
     * Build input state
     */
    buildInput() {
        const forward = (this.keys.forward ? 1 : 0) - (this.keys.backward ? 1 : 0);
        const right = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);

        return {
            forward,
            right,
            jump: this.keys.jump,
            run: this.keys.run,
            crouch: this.keys.crouch,
            yaw: this.yaw
        };
    }

    /**
     * Apply input for client-side prediction
     */
    applyInput(input, deltaTime) {
        // Calculate movement direction
        const cos = Math.cos(this.yaw);
        const sin = Math.sin(this.yaw);

        const forwardX = -sin;
        const forwardZ = -cos;
        const rightX = cos;
        const rightZ = -sin;

        let moveX = input.forward * forwardX + input.right * rightX;
        let moveZ = input.forward * forwardZ + input.right * rightZ;

        // Normalize
        const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (moveLen > 1) {
            moveX /= moveLen;
            moveZ /= moveLen;
        }

        // Determine speed
        this.isRunning = input.run && this.stamina > 0;
        this.isCrouching = input.crouch;

        let targetSpeed;
        if (this.isCrouching) {
            targetSpeed = this.config.crouchSpeed;
        } else if (this.isRunning) {
            targetSpeed = this.config.runSpeed;
        } else {
            targetSpeed = this.config.walkSpeed;
        }

        // Target velocity
        const targetVelX = moveX * targetSpeed;
        const targetVelZ = moveZ * targetSpeed;

        // Acceleration
        const accel = this.isGrounded ? 20 : 20 * this.config.airControl;

        this.predictedVelocity.x = this.approach(this.predictedVelocity.x, targetVelX, accel * deltaTime);
        this.predictedVelocity.z = this.approach(this.predictedVelocity.z, targetVelZ, accel * deltaTime);

        // Gravity
        if (!this.isGrounded) {
            this.predictedVelocity.y += CONFIG.world.gravity * deltaTime;
        }

        // Jump
        if (input.jump && this.isGrounded && !this.isCrouching) {
            this.predictedVelocity.y = this.config.jumpForce;
            this.isGrounded = false;
        }

        // Apply velocity
        this.predictedPosition.x += this.predictedVelocity.x * deltaTime;
        this.predictedPosition.y += this.predictedVelocity.y * deltaTime;
        this.predictedPosition.z += this.predictedVelocity.z * deltaTime;

        // Simple ground collision
        const groundHeight = this.terrainRenderer.getHeightAt(
            this.predictedPosition.x,
            this.predictedPosition.z
        ) + this.physicsConfig.height / 2;

        if (this.predictedPosition.y < groundHeight) {
            this.predictedPosition.y = groundHeight;
            this.predictedVelocity.y = 0;
            this.isGrounded = true;
        }

        // Update stamina
        if (this.isRunning && moveLen > 0) {
            this.stamina = Math.max(0, this.stamina - this.config.staminaDrainRate * deltaTime);
        } else {
            this.stamina = Math.min(this.config.maxStamina, this.stamina + this.config.staminaRegenRate * deltaTime);
        }
    }

    /**
     * Approach value toward target
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
     * Update when in vehicle
     */
    updateInVehicle(deltaTime) {
        // Camera follows vehicle
        // This would be handled by vehicle renderer
    }

    /**
     * Update character mesh position
     */
    updateCharacterMesh() {
        if (!this.characterGroup) return;

        // Use predicted position for smooth local movement
        this.characterGroup.position.copy(this.predictedPosition);
        this.characterGroup.rotation.y = this.yaw;

        // Crouch
        const targetScale = this.isCrouching ? 0.7 : 1.0;
        this.characterGroup.scale.y = THREE.MathUtils.lerp(
            this.characterGroup.scale.y,
            targetScale,
            0.2
        );

        // Animate limbs based on velocity
        if (this.character) {
            const speed = new THREE.Vector2(this.predictedVelocity.x, this.predictedVelocity.z).length();
            this.character.animate(speed * 30);
        }
    }

    /**
     * Update camera
     */
    updateCamera(deltaTime) {
        if (!this.characterGroup) return;

        // Third person camera
        const cameraDistance = 5;
        const cameraHeight = this.isCrouching ? 1.5 : 2;

        // Calculate camera position behind player
        const offsetX = Math.sin(this.yaw) * cameraDistance;
        const offsetZ = Math.cos(this.yaw) * cameraDistance;
        const offsetY = cameraHeight - Math.sin(this.pitch) * cameraDistance * 0.5;

        const targetCameraPos = new THREE.Vector3(
            this.predictedPosition.x + offsetX,
            this.predictedPosition.y + offsetY,
            this.predictedPosition.z + offsetZ
        );

        // Smooth camera movement
        this.camera.position.lerp(targetCameraPos, 0.1);

        // Look at player
        const lookTarget = new THREE.Vector3(
            this.predictedPosition.x,
            this.predictedPosition.y + 1,
            this.predictedPosition.z
        );
        this.camera.lookAt(lookTarget);
    }

    /**
     * Get player position
     */
    getPosition() {
        return this.predictedPosition.clone();
    }

    /**
     * Get player state for UI
     */
    getState() {
        return {
            health: this.health,
            stamina: this.stamina,
            isRunning: this.isRunning,
            isCrouching: this.isCrouching,
            isGrounded: this.isGrounded,
            inVehicle: this.inVehicle,
            position: this.predictedPosition.clone()
        };
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.characterGroup) {
            this.scene.remove(this.characterGroup);
            this.characterGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        }

        for (const entityId of this.otherPlayers.keys()) {
            this.removeOtherPlayer(entityId);
        }
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.PlayerController = PlayerController;
}
