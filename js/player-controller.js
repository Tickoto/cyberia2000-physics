import { CONFIG } from './config.js';
import { Character } from './character.js';

/**
 * PlayerController
 * ----------------
 * A modernized controller that plugs into the physics and world systems used by
 * cyberia-v3.html. The previous implementation belonged to the older
 * network-authoritative prototype and accepted a completely different
 * constructor signature, which is why holding Space would let players “fly” and
 * gravity felt inconsistent. This version matches the expectations from
 * main.js: it consumes the physics system, world manager and UI helpers passed
 * through an options object and drives the local character mesh.
 */
export class PlayerController {
    constructor(options, camera, networkClient, terrainRenderer) {
        // Support both the modern options bag and the legacy positional constructor
        // used by game-client.js. The legacy signature passed (scene, camera,
        // networkClient, terrainRenderer) which resulted in undefined fields when the
        // class expected an object. To keep backwards compatibility we normalize the
        // arguments into an options object here.
        const normalized = (options && options.scene) ? options : {
            scene: options,
            camera,
            worldManager: null,
            logChat: () => {},
            keys: {},
            mouse: { x: 0, y: 0 },
            physics: {
                registerBody: ({ position = new THREE.Vector3(), velocity = new THREE.Vector3(), radius = 0.6, height = 1.7, mass = 85 }) => ({
                    position,
                    velocity,
                    radius,
                    height,
                    mass,
                    grounded: true,
                    friction: CONFIG.groundFriction,
                    damping: CONFIG.airDrag,
                    bounciness: 0.02,
                    set: () => {}
                }),
                step: () => {}
            },
            interactionManager: terrainRenderer?.interactionManager || null,
            environment: null
        };

        const { scene, worldManager, logChat, keys, mouse, physics, interactionManager, environment } = normalized;
        this.scene = scene;
        this.camera = normalized.camera || camera;
        this.worldManager = worldManager;
        this.logChat = logChat;
        this.keys = keys || {};
        this.mouse = mouse || { x: 0, y: 0 };
        this.physics = physics;
        this.interactionManager = interactionManager;
        this.environment = environment;

        // Character setup
        this.char = new Character(true);
        this.scene?.add?.(this.char.group);
        this.characterGroup = this.char.group;

        // Physics body used by PhysicsSystem
        this.physicsBody = this.physics.registerBody({
            position: this.char.group.position,
            velocity: new THREE.Vector3(),
            radius: 0.6,
            height: 1.7,
            mass: 85,
            friction: CONFIG.groundFriction,
            damping: CONFIG.airDrag,
            bounciness: 0.02
        });

        this.predictedPosition = this.physicsBody.position;
        this.inVehicle = false;
        this.vehicleId = null;
        this.health = 100;

        // Camera smoothing
        this.cameraTarget = new THREE.Vector3();
        this.cameraVelocity = new THREE.Vector3();

        // State
        this.yaw = 0;
        this.pitch = 0;
        this.stamina = CONFIG.maxStamina;
        this.isSprinting = false;
        this.isGrounded = false;
        this.jumpCooldown = 0;

        // Interaction
        this.lastInteractionTarget = null;

        this._scratch = {
            moveDir: new THREE.Vector3(),
            forward: new THREE.Vector3(),
            right: new THREE.Vector3(),
            temp: new THREE.Vector3(),
            head: new THREE.Vector3(),
            cameraTarget: new THREE.Vector3()
        };
    }

    /**
     * Main update loop. Called from main.js every frame.
     */
    update(delta) {
        // Apply mouse look
        this.yaw -= this.mouse.x * 0.0025;
        this.pitch = THREE.MathUtils.clamp(this.pitch - this.mouse.y * 0.0025, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);
        this.mouse.x = 0;
        this.mouse.y = 0;

        // Process input and physics
        this.handleMovement(delta);
        this.physics.step(delta, (x, z) => this.worldManager ? this.worldManager.interactionManager.sampleHeight(x, z) : 0);

        // Update character visuals
        this.syncCharacterMesh(delta);
        this.updateCamera(delta);
    }

    /**
     * Build movement intent and feed it to the physics body.
     */
    handleMovement(delta) {
        const { moveDir, forward, right, temp } = this._scratch;

        forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        right.set(forward.z, 0, -forward.x);

        moveDir.set(0, 0, 0);
        if (this.keys['KeyW']) moveDir.add(forward);
        if (this.keys['KeyS']) moveDir.sub(forward);
        if (this.keys['KeyD']) moveDir.add(right);
        if (this.keys['KeyA']) moveDir.sub(right);

        const onGround = this.physicsBody.grounded;
        const desiredSpeed = this.resolveDesiredSpeed(moveDir, onGround);
        const accel = onGround ? CONFIG.groundAccel : CONFIG.airAccel;

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize().multiplyScalar(desiredSpeed);
        }

        temp.set(this.physicsBody.velocity.x, 0, this.physicsBody.velocity.z);
        const diff = moveDir.sub(temp);

        this.physicsBody.velocity.x += THREE.MathUtils.clamp(diff.x, -accel * delta, accel * delta);
        this.physicsBody.velocity.z += THREE.MathUtils.clamp(diff.z, -accel * delta, accel * delta);

        // Jump control with coyote time to avoid flight exploits
        this.jumpCooldown = Math.max(0, this.jumpCooldown - delta);
        if (this.keys['Space'] && onGround && this.jumpCooldown <= 0) {
            this.physicsBody.velocity.y = CONFIG.jumpSpeed;
            this.jumpCooldown = 0.25;
            this.isGrounded = false;
        }

        // Gravity handled by physics system; prevent float drift by clamping
        if (onGround) {
            this.physicsBody.velocity.y = Math.min(this.physicsBody.velocity.y, 2.5);
            this.isGrounded = true;
        }

        // Interaction scan
        this.tryInteract();
    }

    resolveDesiredSpeed(moveDir, grounded) {
        if (moveDir.lengthSq() === 0) return 0;

        const wantsSprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
        const wantsCrouch = this.keys['ControlLeft'] || this.keys['ControlRight'];

        if (wantsSprint && this.stamina > 0 && grounded) {
            this.stamina = Math.max(0, this.stamina - CONFIG.staminaDrainRate * (1 / 60));
            this.isSprinting = true;
            return CONFIG.runSpeed;
        }

        this.isSprinting = false;
        if (wantsCrouch) {
            return CONFIG.crouchSpeed;
        }

        // Recover stamina slowly when not sprinting
        this.stamina = Math.min(CONFIG.maxStamina, this.stamina + CONFIG.staminaRecoveryRate * (1 / 60));
        return CONFIG.speed;
    }

    syncCharacterMesh(delta) {
        const speed = new THREE.Vector2(this.physicsBody.velocity.x, this.physicsBody.velocity.z).length();
        this.char.animate(speed * 3);
        this.char.group.position.copy(this.physicsBody.position);
        this.char.group.rotation.y = this.yaw;

        // Subtle hover fix so the character sits flush on the terrain
        if (this.isGrounded) {
            this.char.group.position.y = Math.max(this.char.group.position.y - 0.02, this.physicsBody.position.y);
        }

        // Keep within reasonable bounds vertically to avoid “fly” glitches
        if (this.char.group.position.y < -50) {
            this.char.group.position.y = this.physicsBody.position.y = 5;
            this.physicsBody.velocity.set(0, 0, 0);
            this.logChat('System', 'Respawned after leaving the playable space.');
        }
    }

    updateCamera(delta) {
        const { cameraTarget } = this._scratch;
        const targetOffset = new THREE.Vector3(0, 1.7, 0);
        cameraTarget.copy(this.char.group.position).add(targetOffset);

        this.cameraTarget.lerp(cameraTarget, 1 - Math.pow(1 - CONFIG.cameraLag, delta * 60));
        this.camera.position.copy(this.cameraTarget);

        const dir = new THREE.Vector3();
        dir.x = Math.sin(this.yaw) * Math.cos(this.pitch);
        dir.y = Math.sin(this.pitch);
        dir.z = Math.cos(this.yaw) * Math.cos(this.pitch);
        dir.normalize();

        this.camera.lookAt(this.cameraTarget.clone().add(dir));
    }

    tryInteract() {
        if (!this.interactionManager) return;
        const { forward, head } = this._scratch;
        head.copy(this.char.group.position);
        head.y += 1.6;

        forward.set(
            Math.sin(this.yaw) * Math.cos(this.pitch),
            Math.sin(this.pitch),
            Math.cos(this.yaw) * Math.cos(this.pitch)
        ).normalize();

        const target = this.interactionManager.findNearestObject(this.char.group.position, this.yaw);
        if (target !== this.lastInteractionTarget) {
            if (target) {
                this.interactionManager.showHint(target);
            } else {
                this.interactionManager.hideHint();
            }
            this.lastInteractionTarget = target;
        }

        let rayLength = CONFIG.interactionRange;
        if (target?.object) {
            rayLength = Math.min(rayLength, head.distanceTo(target.object.position));
        }
        this.interactionManager.updateInteractionRay(head, forward, rayLength);
    }

    // Legacy APIs used by game-client.js
    initPlayer(entityId, clientId, position, appearance) {
        if (position) {
            this.char.group.position.set(position.x, position.y, position.z);
            this.physicsBody.position.copy(this.char.group.position);
        }
        if (appearance?.params) {
            this.char.params = { ...this.char.params, ...appearance.params };
            this.char.rebuild();
        }
        this.predictedPosition = this.physicsBody.position;
    }

    spawnOtherPlayer() {
        // Networking placeholder: legacy client expected this, but the modern
        // controller only manages the local player.
    }

    removeOtherPlayer() {
        // Networking placeholder.
    }

    updateFromServer() {
        // Networking placeholder.
    }

    getState() {
        return {
            health: this.health,
            stamina: this.stamina,
            position: this.getPosition()
        };
    }

    getPosition() {
        return this.physicsBody?.position || this.char.group.position;
    }

    dispose() {
        this.scene?.remove?.(this.char.group);
        this.physics?.bodies?.delete?.(this.physicsBody);
    }
}

// Ensure global access for inline handlers if they exist
if (typeof window !== 'undefined') {
    window.PlayerController = PlayerController;
}
