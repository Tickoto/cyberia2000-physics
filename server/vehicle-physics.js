/**
 * Server-side Vehicle Physics System
 * Handles all vehicle types with Rapier physics
 */

const CONFIG = require('../shared/config.js');

class VehiclePhysicsManager {
    constructor(physicsWorld, terrainManager) {
        this.physicsWorld = physicsWorld;
        this.terrainManager = terrainManager;

        // Vehicle tracking
        this.vehicles = new Map();       // entityId -> vehicle data
        this.vehicleInputs = new Map();  // entityId -> current input state

        // Vehicle types configuration
        this.vehicleTypes = CONFIG.vehicleTypes;
    }

    /**
     * Spawn a vehicle
     */
    spawnVehicle(vehicleType, position, rotation = 0) {
        const entityId = `vehicle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create physics body
        const quaternion = this.yawToQuaternion(rotation);
        const body = this.physicsWorld.createVehicleBody(entityId, vehicleType, position, quaternion);

        if (!body) {
            console.error(`[VehiclePhysics] Failed to create vehicle: ${vehicleType}`);
            return null;
        }

        // Store vehicle data
        this.vehicles.set(entityId, {
            entityId,
            vehicleType,
            driverId: null,
            engineRunning: false,
            health: 100,
            fuel: 100,
            // Wheeled vehicle specific
            wheelStates: this.physicsWorld.entityData.get(entityId)?.wheelStates || null
        });

        // Initialize input state
        this.vehicleInputs.set(entityId, {
            throttle: 0,
            brake: 0,
            steering: 0,
            handbrake: false,
            // Helicopter/aircraft specific
            collective: 0,
            pitch: 0,
            roll: 0,
            yaw: 0
        });

        console.log(`[VehiclePhysics] Spawned ${vehicleType} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
        return entityId;
    }

    /**
     * Remove a vehicle
     */
    removeVehicle(entityId) {
        if (this.vehicles.has(entityId)) {
            this.physicsWorld.removeEntity(entityId);
            this.vehicles.delete(entityId);
            this.vehicleInputs.delete(entityId);
            console.log(`[VehiclePhysics] Removed vehicle: ${entityId}`);
        }
    }

    /**
     * Player enters vehicle
     */
    enterVehicle(entityId, playerId) {
        const vehicle = this.vehicles.get(entityId);
        if (!vehicle) return false;

        if (vehicle.driverId !== null) {
            return false; // Already occupied
        }

        vehicle.driverId = playerId;
        vehicle.engineRunning = true;

        // Update entity data
        const entityData = this.physicsWorld.entityData.get(entityId);
        if (entityData) {
            entityData.driverId = playerId;
        }

        console.log(`[VehiclePhysics] Player ${playerId} entered vehicle ${entityId}`);
        return true;
    }

    /**
     * Player exits vehicle
     */
    exitVehicle(entityId, playerId) {
        const vehicle = this.vehicles.get(entityId);
        if (!vehicle || vehicle.driverId !== playerId) return false;

        vehicle.driverId = null;
        vehicle.engineRunning = false;

        // Reset inputs
        this.vehicleInputs.set(entityId, {
            throttle: 0,
            brake: 0,
            steering: 0,
            handbrake: true,
            collective: 0,
            pitch: 0,
            roll: 0,
            yaw: 0
        });

        // Update entity data
        const entityData = this.physicsWorld.entityData.get(entityId);
        if (entityData) {
            entityData.driverId = null;
        }

        console.log(`[VehiclePhysics] Player ${playerId} exited vehicle ${entityId}`);
        return true;
    }

    /**
     * Update vehicle input from player
     */
    setVehicleInput(entityId, input) {
        if (!this.vehicles.has(entityId)) return;
        this.vehicleInputs.set(entityId, { ...this.vehicleInputs.get(entityId), ...input });
    }

    /**
     * Update all vehicle physics
     */
    update(deltaTime) {
        for (const [entityId, vehicle] of this.vehicles) {
            const input = this.vehicleInputs.get(entityId);
            if (!input) continue;

            switch (vehicle.vehicleType) {
                case 'car':
                case 'truck':
                case 'motorcycle':
                    this.updateWheeledVehicle(entityId, vehicle, input, deltaTime);
                    break;
                case 'tank':
                    this.updateTrackedVehicle(entityId, vehicle, input, deltaTime);
                    break;
                case 'helicopter':
                    this.updateHelicopter(entityId, vehicle, input, deltaTime);
                    break;
                case 'hovercraft':
                    this.updateHovercraft(entityId, vehicle, input, deltaTime);
                    break;
            }
        }
    }

    /**
     * Update wheeled vehicle physics
     */
    updateWheeledVehicle(entityId, vehicle, input, deltaTime) {
        const config = CONFIG.physics.vehicle[vehicle.vehicleType];
        const body = this.physicsWorld.bodies.get(entityId);
        const entityData = this.physicsWorld.entityData.get(entityId);
        if (!body || !entityData || !entityData.wheelStates) return;

        const pos = body.translation();
        const rot = body.rotation();
        const vel = body.linvel();

        // Get forward direction
        const forward = this.rotateVector({ x: 0, y: 0, z: 1 }, rot);
        const right = this.rotateVector({ x: 1, y: 0, z: 0 }, rot);
        const up = this.rotateVector({ x: 0, y: 1, z: 0 }, rot);

        // Current speed along forward axis
        const forwardSpeed = vel.x * forward.x + vel.y * forward.y + vel.z * forward.z;

        // Update wheel states
        for (let i = 0; i < entityData.wheelStates.length; i++) {
            const wheel = entityData.wheelStates[i];
            const worldWheelPos = this.addVectors(pos, this.rotateVector(wheel.position, rot));

            // Raycast for ground contact
            const rayResult = this.physicsWorld.raycast(
                worldWheelPos,
                { x: -up.x, y: -up.y, z: -up.z },
                config.suspensionRestLength + config.wheelRadius + 0.5
            );

            if (rayResult.hit) {
                wheel.groundContact = true;
                const compression = config.suspensionRestLength + config.wheelRadius - rayResult.distance;
                wheel.suspensionLength = Math.max(0, config.suspensionRestLength - compression);

                // Suspension force
                const suspensionForce = compression * config.suspensionStiffness;
                const dampingForce = -wheel.suspensionVelocity * config.suspensionDamping;
                const totalSuspensionForce = Math.min(
                    config.maxSuspensionForce,
                    Math.max(0, suspensionForce + dampingForce)
                );

                // Apply suspension force
                this.physicsWorld.applyForce(entityId, {
                    x: up.x * totalSuspensionForce,
                    y: up.y * totalSuspensionForce,
                    z: up.z * totalSuspensionForce
                }, worldWheelPos);

                // Update wheel steering angle
                if (wheel.steering) {
                    wheel.steerAngle = input.steering * config.maxSteerAngle;
                }

                // Calculate wheel forward based on steering
                const wheelForward = this.rotateVectorY(forward, wheel.steerAngle);

                // Engine force (on powered wheels)
                if (wheel.powered && vehicle.engineRunning) {
                    const engineForce = input.throttle * config.engineForce;
                    this.physicsWorld.applyForce(entityId, {
                        x: wheelForward.x * engineForce,
                        y: wheelForward.y * engineForce,
                        z: wheelForward.z * engineForce
                    }, worldWheelPos);
                }

                // Brake force
                if (input.brake > 0 || input.handbrake) {
                    const brakeForce = input.handbrake ? config.brakeForce * 1.5 : input.brake * config.brakeForce;
                    const brakeDir = this.normalizeVector(vel);
                    const brakeImpulse = Math.min(brakeForce * deltaTime, this.vectorLength(vel) * config.chassisMass);
                    this.physicsWorld.applyImpulse(entityId, {
                        x: -brakeDir.x * brakeImpulse,
                        y: -brakeDir.y * brakeImpulse,
                        z: -brakeDir.z * brakeImpulse
                    });
                }

                // Lateral friction (prevents sliding)
                const lateralVel = vel.x * right.x + vel.y * right.y + vel.z * right.z;
                const frictionForce = -lateralVel * config.frictionSlip * config.chassisMass / entityData.wheelStates.length;
                this.physicsWorld.applyForce(entityId, {
                    x: right.x * frictionForce,
                    y: right.y * frictionForce,
                    z: right.z * frictionForce
                }, worldWheelPos);

                // Update wheel rotation visual
                wheel.rotation += forwardSpeed * deltaTime / config.wheelRadius;
            } else {
                wheel.groundContact = false;
                wheel.suspensionLength = config.suspensionRestLength;
            }

            // Update suspension velocity for damping
            const prevLength = wheel.suspensionLength;
            wheel.suspensionVelocity = (wheel.suspensionLength - prevLength) / deltaTime;
        }
    }

    /**
     * Update tracked vehicle (tank) physics
     */
    updateTrackedVehicle(entityId, vehicle, input, deltaTime) {
        const config = CONFIG.physics.vehicle.tank;
        const body = this.physicsWorld.bodies.get(entityId);
        if (!body) return;

        const pos = body.translation();
        const rot = body.rotation();
        const vel = body.linvel();

        // Get forward direction
        const forward = this.rotateVector({ x: 0, y: 0, z: 1 }, rot);

        // Current speed
        const speed = vel.x * forward.x + vel.y * forward.y + vel.z * forward.z;

        // Check ground contact
        const groundHeight = this.terrainManager.getHeightAt(pos.x, pos.z);
        const isGrounded = pos.y - config.chassisSize.y / 2 < groundHeight + 0.5;

        if (isGrounded && vehicle.engineRunning) {
            // Engine force
            const engineForce = input.throttle * config.engineForce;
            this.physicsWorld.applyForce(entityId, {
                x: forward.x * engineForce,
                y: 0,
                z: forward.z * engineForce
            });

            // Tank turning (differential steering)
            const turnTorque = input.steering * config.turnRate * config.chassisMass;
            this.physicsWorld.applyTorque(entityId, { x: 0, y: turnTorque, z: 0 });

            // Brake
            if (input.brake > 0) {
                const brakeForce = input.brake * config.engineForce * 0.5;
                const brakeDir = this.normalizeVector(vel);
                this.physicsWorld.applyForce(entityId, {
                    x: -brakeDir.x * brakeForce,
                    y: 0,
                    z: -brakeDir.z * brakeForce
                });
            }

            // Track friction (high friction keeps tank stable)
            const lateralVel = this.subtractVectors(vel, this.scaleVector(forward, speed));
            const frictionForce = this.scaleVector(lateralVel, -config.friction * config.chassisMass);
            this.physicsWorld.applyForce(entityId, frictionForce);
        }

        // Speed limit
        if (Math.abs(speed) > config.maxSpeed) {
            const limitedVel = this.scaleVector(forward, Math.sign(speed) * config.maxSpeed);
            this.physicsWorld.setVelocity(entityId, { x: limitedVel.x, y: vel.y, z: limitedVel.z });
        }
    }

    /**
     * Update helicopter physics
     */
    updateHelicopter(entityId, vehicle, input, deltaTime) {
        const config = CONFIG.physics.vehicle.helicopter;
        const body = this.physicsWorld.bodies.get(entityId);
        if (!body) return;

        const pos = body.translation();
        const rot = body.rotation();
        const vel = body.linvel();
        const angVel = body.angvel();

        // Get orientation vectors
        const up = this.rotateVector({ x: 0, y: 1, z: 0 }, rot);
        const forward = this.rotateVector({ x: 0, y: 0, z: 1 }, rot);
        const right = this.rotateVector({ x: 1, y: 0, z: 0 }, rot);

        if (vehicle.engineRunning) {
            // Collective (main lift) - uses throttle input for helicopter
            const collectiveInput = input.collective || input.throttle;
            const liftForce = collectiveInput * config.maxLiftForce;

            // Apply lift in helicopter's up direction
            this.physicsWorld.applyForce(entityId, {
                x: up.x * liftForce,
                y: up.y * liftForce,
                z: up.z * liftForce
            });

            // Counter gravity when hovering
            const hoverForce = config.mass * Math.abs(CONFIG.physics.gravity.y);
            if (collectiveInput > 0.1) {
                this.physicsWorld.applyForce(entityId, { x: 0, y: hoverForce * collectiveInput, z: 0 });
            }

            // Cyclic controls (pitch and roll)
            const pitchInput = input.pitch || (input.throttle > 0 ? -input.steering * 0.3 : 0);
            const rollInput = input.roll || 0;
            const yawInput = input.yaw || input.steering;

            // Apply torques for rotation
            const pitchTorque = pitchInput * config.pitchRate * config.mass;
            const rollTorque = rollInput * config.rollRate * config.mass;
            const yawTorque = yawInput * config.yawRate * config.mass;

            this.physicsWorld.applyTorque(entityId, {
                x: right.x * pitchTorque + forward.x * rollTorque,
                y: yawTorque,
                z: right.z * pitchTorque + forward.z * rollTorque
            });

            // Forward movement when tilted
            const tiltForward = -up.z * config.liftForce * collectiveInput * 0.5;
            const tiltRight = up.x * config.liftForce * collectiveInput * 0.5;
            this.physicsWorld.applyForce(entityId, {
                x: tiltRight,
                y: 0,
                z: tiltForward
            });
        }

        // Angular damping (stabilization)
        this.physicsWorld.applyTorque(entityId, {
            x: -angVel.x * config.angularDamping * config.mass,
            y: -angVel.y * config.angularDamping * config.mass * 0.5,
            z: -angVel.z * config.angularDamping * config.mass
        });

        // Speed limit
        const speed = this.vectorLength(vel);
        if (speed > config.maxSpeed) {
            const limitedVel = this.scaleVector(this.normalizeVector(vel), config.maxSpeed);
            this.physicsWorld.setVelocity(entityId, limitedVel);
        }

        // Altitude limit
        if (pos.y > config.maxAltitude) {
            this.physicsWorld.setPosition(entityId, { x: pos.x, y: config.maxAltitude, z: pos.z });
            if (vel.y > 0) {
                this.physicsWorld.setVelocity(entityId, { x: vel.x, y: 0, z: vel.z });
            }
        }

        // Ground collision prevention
        const groundHeight = this.terrainManager.getHeightAt(pos.x, pos.z);
        const minAltitude = groundHeight + config.bodySize.y;
        if (pos.y < minAltitude) {
            this.physicsWorld.setPosition(entityId, { x: pos.x, y: minAltitude, z: pos.z });
            if (vel.y < 0) {
                this.physicsWorld.setVelocity(entityId, { x: vel.x, y: 0, z: vel.z });
            }
        }
    }

    /**
     * Update hovercraft physics
     */
    updateHovercraft(entityId, vehicle, input, deltaTime) {
        const config = CONFIG.physics.vehicle.hovercraft;
        const body = this.physicsWorld.bodies.get(entityId);
        if (!body) return;

        const pos = body.translation();
        const rot = body.rotation();
        const vel = body.linvel();

        // Get forward direction (horizontal only)
        const forward = this.rotateVector({ x: 0, y: 0, z: 1 }, rot);
        forward.y = 0;
        const len = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
        if (len > 0) {
            forward.x /= len;
            forward.z /= len;
        }

        // Get terrain height
        const groundHeight = this.terrainManager.getHeightAt(pos.x, pos.z);
        const targetHeight = groundHeight + config.hoverHeight + config.bodySize.y / 2;

        if (vehicle.engineRunning) {
            // Hover force (spring-damper system)
            const heightDiff = targetHeight - pos.y;
            const hoverForce = heightDiff * config.hoverForce - vel.y * config.hoverForce * 0.5;
            this.physicsWorld.applyForce(entityId, { x: 0, y: hoverForce, z: 0 });

            // Thrust
            const thrustForce = input.throttle * config.thrustForce;
            this.physicsWorld.applyForce(entityId, {
                x: forward.x * thrustForce,
                y: 0,
                z: forward.z * thrustForce
            });

            // Turning
            const turnTorque = input.steering * config.turnRate * config.mass;
            this.physicsWorld.applyTorque(entityId, { x: 0, y: turnTorque, z: 0 });

            // Brake (air brake)
            if (input.brake > 0) {
                const brakeForce = input.brake * config.thrustForce * 0.3;
                const brakeDir = this.normalizeVector({ x: vel.x, y: 0, z: vel.z });
                this.physicsWorld.applyForce(entityId, {
                    x: -brakeDir.x * brakeForce,
                    y: 0,
                    z: -brakeDir.z * brakeForce
                });
            }
        } else {
            // Passive hover (reduced force when engine off)
            const heightDiff = targetHeight - pos.y;
            const hoverForce = heightDiff * config.hoverForce * 0.3;
            this.physicsWorld.applyForce(entityId, { x: 0, y: Math.max(0, hoverForce), z: 0 });
        }

        // Low friction movement (slides easily)
        const drag = this.scaleVector(vel, -config.linearDamping);
        this.physicsWorld.applyForce(entityId, drag);
    }

    /**
     * Get vehicle state for networking
     */
    getVehicleState(entityId) {
        const vehicle = this.vehicles.get(entityId);
        if (!vehicle) return null;

        const state = this.physicsWorld.getEntityState(entityId);
        if (!state) return null;

        return {
            ...state,
            vehicleType: vehicle.vehicleType,
            driverId: vehicle.driverId,
            engineRunning: vehicle.engineRunning,
            health: vehicle.health,
            fuel: vehicle.fuel
        };
    }

    /**
     * Get all vehicle states
     */
    getAllVehicleStates() {
        const states = [];
        for (const entityId of this.vehicles.keys()) {
            const state = this.getVehicleState(entityId);
            if (state) states.push(state);
        }
        return states;
    }

    /**
     * Find nearest vehicle to position
     */
    findNearestVehicle(position, maxDistance = 5) {
        let nearest = null;
        let nearestDist = maxDistance;

        for (const [entityId, vehicle] of this.vehicles) {
            const state = this.physicsWorld.getEntityState(entityId);
            if (!state) continue;

            const dx = state.position.x - position.x;
            const dy = state.position.y - position.y;
            const dz = state.position.z - position.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = {
                    entityId,
                    vehicleType: vehicle.vehicleType,
                    distance: dist,
                    occupied: vehicle.driverId !== null
                };
            }
        }

        return nearest;
    }

    /**
     * Get vehicle by driver
     */
    getVehicleByDriver(playerId) {
        for (const [entityId, vehicle] of this.vehicles) {
            if (vehicle.driverId === playerId) {
                return entityId;
            }
        }
        return null;
    }

    // Vector math helpers
    rotateVector(v, q) {
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
        const ix = qw * v.x + qy * v.z - qz * v.y;
        const iy = qw * v.y + qz * v.x - qx * v.z;
        const iz = qw * v.z + qx * v.y - qy * v.x;
        const iw = -qx * v.x - qy * v.y - qz * v.z;
        return {
            x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
            y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
            z: iz * qw + iw * -qz + ix * -qy - iy * -qx
        };
    }

    rotateVectorY(v, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: v.x * cos + v.z * sin,
            y: v.y,
            z: -v.x * sin + v.z * cos
        };
    }

    yawToQuaternion(yaw) {
        const halfYaw = yaw / 2;
        return {
            x: 0,
            y: Math.sin(halfYaw),
            z: 0,
            w: Math.cos(halfYaw)
        };
    }

    addVectors(a, b) {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    }

    subtractVectors(a, b) {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    }

    scaleVector(v, s) {
        return { x: v.x * s, y: v.y * s, z: v.z * s };
    }

    normalizeVector(v) {
        const len = this.vectorLength(v);
        if (len === 0) return { x: 0, y: 0, z: 0 };
        return { x: v.x / len, y: v.y / len, z: v.z / len };
    }

    vectorLength(v) {
        return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }
}

module.exports = VehiclePhysicsManager;
