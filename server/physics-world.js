/**
 * Server-side Rapier Physics World Manager
 * Manages the authoritative physics simulation
 */

const RAPIER = require('@dimforge/rapier3d-compat');
const CONFIG = require('../shared/config.js');

class PhysicsWorld {
    constructor() {
        this.world = null;
        this.initialized = false;

        // Entity tracking
        this.bodies = new Map();         // entityId -> rigidBody
        this.colliders = new Map();      // entityId -> collider[]
        this.entityData = new Map();     // entityId -> { type, ownerId, ... }

        // Terrain chunks
        this.terrainChunks = new Map();  // "chunkX,chunkZ" -> { collider, heightmap }

        // Event queues
        this.collisionEvents = [];
        this.contactEvents = [];

        // Physics groups
        this.COLLISION_GROUPS = {
            TERRAIN: 0x0001,
            PLAYER: 0x0002,
            VEHICLE: 0x0004,
            BUILDING: 0x0008,
            PROJECTILE: 0x0010,
            ITEM: 0x0020,
            SENSOR: 0x0040
        };

        // Collision masks (what each group collides with)
        this.COLLISION_MASKS = {
            TERRAIN: 0xFFFF,  // Collides with everything
            PLAYER: 0x000F,   // Terrain, other players, vehicles, buildings
            VEHICLE: 0x000F,  // Terrain, players, other vehicles, buildings
            BUILDING: 0x001F, // Everything except sensors
            PROJECTILE: 0x001F,
            ITEM: 0x0001,     // Just terrain
            SENSOR: 0x0000    // No physical collisions
        };
    }

    async init() {
        await RAPIER.init();

        const gravity = CONFIG.physics.gravity;
        this.world = new RAPIER.World({ x: gravity.x, y: gravity.y, z: gravity.z });

        // Configure solver
        this.world.numSolverIterations = 4;
        this.world.numAdditionalFrictionIterations = 1;
        this.world.numInternalPgsIterations = 1;

        this.initialized = true;
        console.log('[PhysicsWorld] Rapier physics initialized');
        return this;
    }

    /**
     * Step the physics simulation
     */
    step(deltaTime) {
        if (!this.initialized) return;

        // Clear event queues
        this.collisionEvents = [];
        this.contactEvents = [];

        // Step physics
        this.world.step();

        // Collect collision events
        this.world.contactsWith(null, (contact) => {
            this.contactEvents.push(contact);
        });
    }

    /**
     * Create a player rigid body (capsule)
     */
    createPlayerBody(entityId, position, ownerId) {
        const config = CONFIG.physics.player;

        // Create rigid body
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y + config.height / 2, position.z)
            .setLinearDamping(config.linearDamping)
            .setAngularDamping(config.angularDamping)
            .lockRotations(); // Players don't tumble

        const body = this.world.createRigidBody(bodyDesc);

        // Create capsule collider
        const colliderDesc = RAPIER.ColliderDesc.capsule(config.height / 2 - config.radius, config.radius)
            .setMass(config.mass)
            .setFriction(config.friction)
            .setRestitution(config.restitution)
            .setCollisionGroups(this.makeCollisionGroups(this.COLLISION_GROUPS.PLAYER, this.COLLISION_MASKS.PLAYER));

        const collider = this.world.createCollider(colliderDesc, body);

        // Store references
        this.bodies.set(entityId, body);
        this.colliders.set(entityId, [collider]);
        this.entityData.set(entityId, {
            type: CONFIG.entityTypes.PLAYER,
            ownerId: ownerId,
            grounded: false,
            groundNormal: { x: 0, y: 1, z: 0 }
        });

        return body;
    }

    /**
     * Create a vehicle rigid body
     */
    createVehicleBody(entityId, vehicleType, position, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
        const vehicleConfig = CONFIG.physics.vehicle[vehicleType];
        if (!vehicleConfig) {
            console.error(`[PhysicsWorld] Unknown vehicle type: ${vehicleType}`);
            return null;
        }

        let body, colliders = [];

        if (vehicleType === 'helicopter') {
            // Helicopter - single body with no wheels
            const size = vehicleConfig.bodySize;
            const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(position.x, position.y + size.y, position.z)
                .setRotation(rotation)
                .setLinearDamping(vehicleConfig.linearDamping)
                .setAngularDamping(vehicleConfig.angularDamping);

            body = this.world.createRigidBody(bodyDesc);

            const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
                .setMass(vehicleConfig.mass)
                .setFriction(0.5)
                .setRestitution(0.2)
                .setCollisionGroups(this.makeCollisionGroups(this.COLLISION_GROUPS.VEHICLE, this.COLLISION_MASKS.VEHICLE));

            colliders.push(this.world.createCollider(colliderDesc, body));

        } else if (vehicleType === 'tank') {
            // Tank - tracked vehicle (simplified as box)
            const size = vehicleConfig.chassisSize;
            const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(position.x, position.y + size.y, position.z)
                .setRotation(rotation)
                .setLinearDamping(0.3)
                .setAngularDamping(0.5);

            body = this.world.createRigidBody(bodyDesc);

            const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
                .setMass(vehicleConfig.chassisMass)
                .setFriction(vehicleConfig.friction)
                .setRestitution(0.1)
                .setCollisionGroups(this.makeCollisionGroups(this.COLLISION_GROUPS.VEHICLE, this.COLLISION_MASKS.VEHICLE));

            colliders.push(this.world.createCollider(colliderDesc, body));

        } else if (vehicleType === 'hovercraft') {
            // Hovercraft - hovering vehicle
            const size = vehicleConfig.bodySize;
            const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(position.x, position.y + vehicleConfig.hoverHeight + size.y / 2, position.z)
                .setRotation(rotation)
                .setLinearDamping(vehicleConfig.linearDamping)
                .setAngularDamping(0.5)
                .setGravityScale(0.0); // Hovercraft manages its own "gravity"

            body = this.world.createRigidBody(bodyDesc);

            const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
                .setMass(vehicleConfig.mass)
                .setFriction(vehicleConfig.friction)
                .setRestitution(0.2)
                .setCollisionGroups(this.makeCollisionGroups(this.COLLISION_GROUPS.VEHICLE, this.COLLISION_MASKS.VEHICLE));

            colliders.push(this.world.createCollider(colliderDesc, body));

        } else {
            // Wheeled vehicles (car, truck, motorcycle)
            const chassisSize = vehicleConfig.chassisSize;
            const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(position.x, position.y + vehicleConfig.wheelRadius + vehicleConfig.suspensionRestLength + chassisSize.y / 2, position.z)
                .setRotation(rotation)
                .setLinearDamping(0.1)
                .setAngularDamping(0.3);

            body = this.world.createRigidBody(bodyDesc);

            // Chassis collider
            const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(chassisSize.x / 2, chassisSize.y / 2, chassisSize.z / 2)
                .setMass(vehicleConfig.chassisMass)
                .setFriction(0.5)
                .setRestitution(0.2)
                .setCollisionGroups(this.makeCollisionGroups(this.COLLISION_GROUPS.VEHICLE, this.COLLISION_MASKS.VEHICLE));

            colliders.push(this.world.createCollider(chassisColliderDesc, body));
        }

        // Store references
        this.bodies.set(entityId, body);
        this.colliders.set(entityId, colliders);
        this.entityData.set(entityId, {
            type: CONFIG.entityTypes.VEHICLE,
            vehicleType: vehicleType,
            ownerId: null,
            driverId: null,
            wheelStates: vehicleType !== 'helicopter' && vehicleType !== 'tank' && vehicleType !== 'hovercraft' ?
                this.initWheelStates(vehicleType) : null
        });

        return body;
    }

    /**
     * Initialize wheel states for wheeled vehicles
     */
    initWheelStates(vehicleType) {
        const config = CONFIG.physics.vehicle[vehicleType];
        const chassisSize = config.chassisSize;

        // Wheel positions relative to chassis center
        const wheelPositions = vehicleType === 'motorcycle' ? [
            { x: 0, y: -chassisSize.y / 2, z: chassisSize.z / 2 - config.wheelRadius },  // Front
            { x: 0, y: -chassisSize.y / 2, z: -chassisSize.z / 2 + config.wheelRadius }  // Rear
        ] : [
            { x: -chassisSize.x / 2 + 0.1, y: -chassisSize.y / 2, z: chassisSize.z / 2 - config.wheelRadius * 1.5 },   // Front left
            { x: chassisSize.x / 2 - 0.1, y: -chassisSize.y / 2, z: chassisSize.z / 2 - config.wheelRadius * 1.5 },    // Front right
            { x: -chassisSize.x / 2 + 0.1, y: -chassisSize.y / 2, z: -chassisSize.z / 2 + config.wheelRadius * 1.5 },  // Rear left
            { x: chassisSize.x / 2 - 0.1, y: -chassisSize.y / 2, z: -chassisSize.z / 2 + config.wheelRadius * 1.5 }    // Rear right
        ];

        return wheelPositions.map((pos, i) => ({
            position: pos,
            steering: i < (vehicleType === 'motorcycle' ? 1 : 2), // Front wheels steer
            powered: vehicleType === 'motorcycle' || i >= 2,      // Rear wheels powered (or all for motorcycle)
            suspensionLength: config.suspensionRestLength,
            suspensionVelocity: 0,
            groundContact: false,
            rotation: 0,
            steerAngle: 0
        }));
    }

    /**
     * Create terrain chunk collider
     */
    createTerrainChunk(chunkX, chunkZ, heightmap, resolution) {
        const key = `${chunkX},${chunkZ}`;
        if (this.terrainChunks.has(key)) return;

        const chunkSize = CONFIG.world.chunkSize;
        const scale = { x: chunkSize / resolution, y: 1, z: chunkSize / resolution };
        const worldX = chunkX * chunkSize;
        const worldZ = chunkZ * chunkSize;

        // Create heightfield collider
        const heightfieldDesc = RAPIER.ColliderDesc.heightfield(
            resolution, resolution,
            heightmap,
            scale
        )
            .setTranslation(worldX + chunkSize / 2, 0, worldZ + chunkSize / 2)
            .setFriction(CONFIG.physics.terrain.friction)
            .setRestitution(CONFIG.physics.terrain.restitution)
            .setCollisionGroups(this.makeCollisionGroups(this.COLLISION_GROUPS.TERRAIN, this.COLLISION_MASKS.TERRAIN));

        const collider = this.world.createCollider(heightfieldDesc);

        this.terrainChunks.set(key, {
            collider: collider,
            heightmap: heightmap,
            chunkX: chunkX,
            chunkZ: chunkZ
        });

        return collider;
    }

    /**
     * Remove terrain chunk collider
     */
    removeTerrainChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const chunk = this.terrainChunks.get(key);
        if (chunk) {
            this.world.removeCollider(chunk.collider, false);
            this.terrainChunks.delete(key);
        }
    }

    /**
     * Create building collider
     */
    createBuildingCollider(entityId, position, size, rotation = 0) {
        const colliderDesc = RAPIER.ColliderDesc.cuboid(size.width / 2, size.height / 2, size.depth / 2)
            .setTranslation(position.x, position.y + size.height / 2, position.z)
            .setRotation({ x: 0, y: Math.sin(rotation / 2), z: 0, w: Math.cos(rotation / 2) })
            .setFriction(CONFIG.physics.building.friction)
            .setRestitution(CONFIG.physics.building.restitution)
            .setCollisionGroups(this.makeCollisionGroups(this.COLLISION_GROUPS.BUILDING, this.COLLISION_MASKS.BUILDING));

        const collider = this.world.createCollider(colliderDesc);
        this.colliders.set(entityId, [collider]);
        this.entityData.set(entityId, {
            type: CONFIG.entityTypes.BUILDING,
            position: position,
            size: size
        });

        return collider;
    }

    /**
     * Remove entity from physics world
     */
    removeEntity(entityId) {
        const body = this.bodies.get(entityId);
        if (body) {
            this.world.removeRigidBody(body);
            this.bodies.delete(entityId);
        }

        const colliders = this.colliders.get(entityId);
        if (colliders) {
            // Colliders attached to bodies are removed automatically
            if (!body) {
                colliders.forEach(c => this.world.removeCollider(c, false));
            }
            this.colliders.delete(entityId);
        }

        this.entityData.delete(entityId);
    }

    /**
     * Apply force to entity
     */
    applyForce(entityId, force, point = null) {
        const body = this.bodies.get(entityId);
        if (!body) return;

        if (point) {
            body.addForceAtPoint(force, point, true);
        } else {
            body.addForce(force, true);
        }
    }

    /**
     * Apply impulse to entity
     */
    applyImpulse(entityId, impulse, point = null) {
        const body = this.bodies.get(entityId);
        if (!body) return;

        if (point) {
            body.applyImpulseAtPoint(impulse, point, true);
        } else {
            body.applyImpulse(impulse, true);
        }
    }

    /**
     * Apply torque to entity
     */
    applyTorque(entityId, torque) {
        const body = this.bodies.get(entityId);
        if (!body) return;

        body.addTorque(torque, true);
    }

    /**
     * Set entity velocity
     */
    setVelocity(entityId, velocity) {
        const body = this.bodies.get(entityId);
        if (!body) return;

        body.setLinvel(velocity, true);
    }

    /**
     * Set entity angular velocity
     */
    setAngularVelocity(entityId, angularVelocity) {
        const body = this.bodies.get(entityId);
        if (!body) return;

        body.setAngvel(angularVelocity, true);
    }

    /**
     * Set entity position
     */
    setPosition(entityId, position) {
        const body = this.bodies.get(entityId);
        if (!body) return;

        body.setTranslation(position, true);
    }

    /**
     * Set entity rotation (quaternion)
     */
    setRotation(entityId, rotation) {
        const body = this.bodies.get(entityId);
        if (!body) return;

        body.setRotation(rotation, true);
    }

    /**
     * Get entity state for networking
     */
    getEntityState(entityId) {
        const body = this.bodies.get(entityId);
        const data = this.entityData.get(entityId);
        if (!body || !data) return null;

        const pos = body.translation();
        const rot = body.rotation();
        const vel = body.linvel();
        const angVel = body.angvel();

        return {
            entityId: entityId,
            type: data.type,
            position: { x: pos.x, y: pos.y, z: pos.z },
            rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
            velocity: { x: vel.x, y: vel.y, z: vel.z },
            angularVelocity: { x: angVel.x, y: angVel.y, z: angVel.z },
            ...this.getTypeSpecificState(entityId, data)
        };
    }

    /**
     * Get type-specific state data
     */
    getTypeSpecificState(entityId, data) {
        switch (data.type) {
            case CONFIG.entityTypes.PLAYER:
                return {
                    grounded: data.grounded,
                    groundNormal: data.groundNormal
                };
            case CONFIG.entityTypes.VEHICLE:
                return {
                    vehicleType: data.vehicleType,
                    driverId: data.driverId,
                    wheelStates: data.wheelStates
                };
            default:
                return {};
        }
    }

    /**
     * Perform raycast
     */
    raycast(origin, direction, maxDistance, filterMask = 0xFFFF) {
        const ray = new RAPIER.Ray(origin, direction);
        const hit = this.world.castRay(ray, maxDistance, true, filterMask);

        if (hit) {
            const hitPoint = ray.pointAt(hit.toi);
            const hitCollider = hit.collider;

            // Find entity that owns this collider
            let hitEntityId = null;
            for (const [id, colliders] of this.colliders) {
                if (colliders.includes(hitCollider)) {
                    hitEntityId = id;
                    break;
                }
            }

            return {
                hit: true,
                point: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
                normal: hit.normal ? { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } : null,
                distance: hit.toi,
                entityId: hitEntityId
            };
        }

        return { hit: false };
    }

    /**
     * Check if player is grounded using raycast
     */
    updatePlayerGrounded(entityId) {
        const body = this.bodies.get(entityId);
        const data = this.entityData.get(entityId);
        if (!body || !data || data.type !== CONFIG.entityTypes.PLAYER) return;

        const pos = body.translation();
        const config = CONFIG.physics.player;

        // Cast ray downward from player center
        const rayOrigin = { x: pos.x, y: pos.y, z: pos.z };
        const rayDir = { x: 0, y: -1, z: 0 };
        const rayLength = config.height / 2 + 0.2; // Slightly longer than half height

        const result = this.raycast(rayOrigin, rayDir, rayLength, this.COLLISION_GROUPS.TERRAIN | this.COLLISION_GROUPS.BUILDING);

        data.grounded = result.hit && result.distance < (config.height / 2 + 0.1);
        if (result.normal) {
            data.groundNormal = result.normal;
        }
    }

    /**
     * Make collision group bits
     */
    makeCollisionGroups(membership, filter) {
        return (membership << 16) | filter;
    }

    /**
     * Get all entity states for snapshot
     */
    getAllEntityStates() {
        const states = [];
        for (const entityId of this.bodies.keys()) {
            const state = this.getEntityState(entityId);
            if (state) states.push(state);
        }
        return states;
    }

    /**
     * Get loaded terrain chunk keys
     */
    getLoadedChunkKeys() {
        return Array.from(this.terrainChunks.keys());
    }

    /**
     * Check if chunk is loaded
     */
    isChunkLoaded(chunkX, chunkZ) {
        return this.terrainChunks.has(`${chunkX},${chunkZ}`);
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.world) {
            this.world.free();
            this.world = null;
        }
        this.bodies.clear();
        this.colliders.clear();
        this.entityData.clear();
        this.terrainChunks.clear();
        this.initialized = false;
    }
}

module.exports = PhysicsWorld;
