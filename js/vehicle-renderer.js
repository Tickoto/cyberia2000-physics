/**
 * Client-side Vehicle Renderer and Controller
 * Renders vehicles and handles local vehicle input
 */

class VehicleRenderer {
    constructor(scene, networkClient) {
        this.scene = scene;
        this.networkClient = networkClient;

        // Vehicle tracking
        this.vehicles = new Map();       // entityId -> { mesh, type, state }
        this.localVehicleId = null;      // Vehicle the local player is driving

        // Vehicle configurations
        this.vehicleConfigs = CONFIG.physics.vehicle;

        this.smoothingWindow = (CONFIG.networkInterpolationDelay || 100) / 1000;

        // Input state
        this.inputState = {
            throttle: 0,
            brake: 0,
            steering: 0,
            handbrake: false,
            collective: 0,
            pitch: 0,
            roll: 0,
            yaw: 0
        };

        // Key bindings
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            brake: false,
            handbrake: false,
            up: false,
            down: false
        };
    }

    /**
     * Create vehicle mesh based on type
     */
    createVehicleMesh(vehicleType) {
        switch (vehicleType) {
            case 'car':
                return this.createCarMesh();
            case 'truck':
                return this.createTruckMesh();
            case 'motorcycle':
                return this.createMotorcycleMesh();
            case 'tank':
                return this.createTankMesh();
            case 'helicopter':
                return this.createHelicopterMesh();
            case 'hovercraft':
                return this.createHovercraftMesh();
            default:
                return this.createCarMesh();
        }
    }

    /**
     * Create car mesh
     */
    createCarMesh() {
        const group = new THREE.Group();
        const config = this.vehicleConfigs.car;

        // Body
        const bodyGeom = new THREE.BoxGeometry(
            config.chassisSize.x,
            config.chassisSize.y,
            config.chassisSize.z
        );
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x3366cc,
            roughness: 0.3,
            metalness: 0.7
        });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.position.y = config.chassisSize.y / 2;
        body.castShadow = true;
        group.add(body);

        // Cabin
        const cabinGeom = new THREE.BoxGeometry(
            config.chassisSize.x * 0.8,
            config.chassisSize.y * 0.6,
            config.chassisSize.z * 0.5
        );
        const cabinMat = new THREE.MeshStandardMaterial({
            color: 0x222233,
            roughness: 0.1,
            metalness: 0.3,
            transparent: true,
            opacity: 0.7
        });
        const cabin = new THREE.Mesh(cabinGeom, cabinMat);
        cabin.position.set(0, config.chassisSize.y + config.chassisSize.y * 0.3, 0);
        group.add(cabin);

        // Wheels
        const wheelGeom = new THREE.CylinderGeometry(
            config.wheelRadius,
            config.wheelRadius,
            config.wheelWidth,
            16
        );
        const wheelMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.8
        });

        const wheelPositions = [
            { x: -config.chassisSize.x / 2, z: config.chassisSize.z / 2 - config.wheelRadius * 1.5 },
            { x: config.chassisSize.x / 2, z: config.chassisSize.z / 2 - config.wheelRadius * 1.5 },
            { x: -config.chassisSize.x / 2, z: -config.chassisSize.z / 2 + config.wheelRadius * 1.5 },
            { x: config.chassisSize.x / 2, z: -config.chassisSize.z / 2 + config.wheelRadius * 1.5 }
        ];

        group.wheels = [];
        wheelPositions.forEach((pos, i) => {
            const wheel = new THREE.Mesh(wheelGeom, wheelMat);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(pos.x, config.wheelRadius, pos.z);
            wheel.castShadow = true;
            group.add(wheel);
            group.wheels.push(wheel);
        });

        return group;
    }

    /**
     * Create truck mesh
     */
    createTruckMesh() {
        const group = new THREE.Group();
        const config = this.vehicleConfigs.truck;

        // Cab
        const cabGeom = new THREE.BoxGeometry(
            config.chassisSize.x,
            config.chassisSize.y * 1.2,
            config.chassisSize.z * 0.35
        );
        const cabMat = new THREE.MeshStandardMaterial({
            color: 0xcc3333,
            roughness: 0.4,
            metalness: 0.6
        });
        const cab = new THREE.Mesh(cabGeom, cabMat);
        cab.position.set(0, config.chassisSize.y * 0.6, config.chassisSize.z * 0.3);
        cab.castShadow = true;
        group.add(cab);

        // Bed
        const bedGeom = new THREE.BoxGeometry(
            config.chassisSize.x,
            config.chassisSize.y * 0.5,
            config.chassisSize.z * 0.55
        );
        const bedMat = new THREE.MeshStandardMaterial({
            color: 0x666666,
            roughness: 0.7
        });
        const bed = new THREE.Mesh(bedGeom, bedMat);
        bed.position.set(0, config.chassisSize.y * 0.25, -config.chassisSize.z * 0.2);
        bed.castShadow = true;
        group.add(bed);

        // Wheels (6 wheels for truck)
        const wheelGeom = new THREE.CylinderGeometry(
            config.wheelRadius,
            config.wheelRadius,
            config.wheelWidth,
            16
        );
        const wheelMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.8
        });

        group.wheels = [];
        const wheelPositions = [
            { x: -config.chassisSize.x / 2, z: config.chassisSize.z * 0.35 },
            { x: config.chassisSize.x / 2, z: config.chassisSize.z * 0.35 },
            { x: -config.chassisSize.x / 2, z: -config.chassisSize.z * 0.15 },
            { x: config.chassisSize.x / 2, z: -config.chassisSize.z * 0.15 },
            { x: -config.chassisSize.x / 2, z: -config.chassisSize.z * 0.35 },
            { x: config.chassisSize.x / 2, z: -config.chassisSize.z * 0.35 }
        ];

        wheelPositions.forEach(pos => {
            const wheel = new THREE.Mesh(wheelGeom, wheelMat);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(pos.x, config.wheelRadius, pos.z);
            wheel.castShadow = true;
            group.add(wheel);
            group.wheels.push(wheel);
        });

        return group;
    }

    /**
     * Create motorcycle mesh
     */
    createMotorcycleMesh() {
        const group = new THREE.Group();
        const config = this.vehicleConfigs.motorcycle;

        // Body/frame
        const bodyGeom = new THREE.BoxGeometry(
            config.chassisSize.x,
            config.chassisSize.y,
            config.chassisSize.z
        );
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.3,
            metalness: 0.8
        });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.position.y = config.chassisSize.y / 2 + config.wheelRadius;
        body.castShadow = true;
        group.add(body);

        // Tank
        const tankGeom = new THREE.BoxGeometry(
            config.chassisSize.x * 1.5,
            config.chassisSize.y * 0.6,
            config.chassisSize.z * 0.4
        );
        const tankMat = new THREE.MeshStandardMaterial({
            color: 0xff4400,
            roughness: 0.2,
            metalness: 0.8
        });
        const tank = new THREE.Mesh(tankGeom, tankMat);
        tank.position.set(0, config.chassisSize.y + config.wheelRadius, config.chassisSize.z * 0.1);
        group.add(tank);

        // Wheels
        const wheelGeom = new THREE.CylinderGeometry(
            config.wheelRadius,
            config.wheelRadius,
            config.wheelWidth,
            16
        );
        const wheelMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.8
        });

        group.wheels = [];
        [config.chassisSize.z / 2, -config.chassisSize.z / 2].forEach(z => {
            const wheel = new THREE.Mesh(wheelGeom, wheelMat);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(0, config.wheelRadius, z);
            wheel.castShadow = true;
            group.add(wheel);
            group.wheels.push(wheel);
        });

        return group;
    }

    /**
     * Create tank mesh
     */
    createTankMesh() {
        const group = new THREE.Group();
        const config = this.vehicleConfigs.tank;

        // Hull
        const hullGeom = new THREE.BoxGeometry(
            config.chassisSize.x,
            config.chassisSize.y * 0.6,
            config.chassisSize.z
        );
        const hullMat = new THREE.MeshStandardMaterial({
            color: 0x445544,
            roughness: 0.8,
            metalness: 0.4
        });
        const hull = new THREE.Mesh(hullGeom, hullMat);
        hull.position.y = config.chassisSize.y * 0.3;
        hull.castShadow = true;
        group.add(hull);

        // Turret
        const turretGeom = new THREE.CylinderGeometry(
            config.chassisSize.x * 0.4,
            config.chassisSize.x * 0.45,
            config.chassisSize.y * 0.4,
            8
        );
        const turret = new THREE.Mesh(turretGeom, hullMat);
        turret.position.set(0, config.chassisSize.y * 0.8, 0);
        turret.castShadow = true;
        group.add(turret);
        group.turret = turret;

        // Barrel
        const barrelGeom = new THREE.CylinderGeometry(0.15, 0.15, 4, 8);
        const barrel = new THREE.Mesh(barrelGeom, hullMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0, 2.5);
        turret.add(barrel);

        // Tracks (simplified as boxes)
        const trackGeom = new THREE.BoxGeometry(
            config.trackWidth,
            config.chassisSize.y * 0.4,
            config.trackLength
        );
        const trackMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.9
        });

        [-config.chassisSize.x / 2 - config.trackWidth / 2, config.chassisSize.x / 2 + config.trackWidth / 2].forEach(x => {
            const track = new THREE.Mesh(trackGeom, trackMat);
            track.position.set(x, config.chassisSize.y * 0.2, 0);
            track.castShadow = true;
            group.add(track);
        });

        return group;
    }

    /**
     * Create helicopter mesh
     */
    createHelicopterMesh() {
        const group = new THREE.Group();
        const config = this.vehicleConfigs.helicopter;

        // Fuselage
        const bodyGeom = new THREE.BoxGeometry(
            config.bodySize.x,
            config.bodySize.y,
            config.bodySize.z
        );
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x2255aa,
            roughness: 0.3,
            metalness: 0.7
        });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.castShadow = true;
        group.add(body);

        // Cockpit
        const cockpitGeom = new THREE.SphereGeometry(config.bodySize.x * 0.6, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const cockpitMat = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            roughness: 0.1,
            transparent: true,
            opacity: 0.6
        });
        const cockpit = new THREE.Mesh(cockpitGeom, cockpitMat);
        cockpit.rotation.x = -Math.PI / 2;
        cockpit.position.set(0, config.bodySize.y / 2, config.bodySize.z * 0.3);
        group.add(cockpit);

        // Tail boom
        const tailGeom = new THREE.BoxGeometry(0.5, 0.5, config.bodySize.z * 0.8);
        const tail = new THREE.Mesh(tailGeom, bodyMat);
        tail.position.set(0, 0, -config.bodySize.z * 0.7);
        tail.castShadow = true;
        group.add(tail);

        // Main rotor
        const rotorGeom = new THREE.BoxGeometry(config.bodySize.x * 3, 0.1, 0.3);
        const rotorMat = new THREE.MeshStandardMaterial({
            color: 0x444444,
            roughness: 0.5
        });
        const rotor = new THREE.Mesh(rotorGeom, rotorMat);
        rotor.position.set(0, config.bodySize.y / 2 + 0.5, 0);
        group.add(rotor);
        group.mainRotor = rotor;

        // Second rotor blade
        const rotor2 = new THREE.Mesh(rotorGeom, rotorMat);
        rotor2.rotation.y = Math.PI / 2;
        rotor2.position.set(0, config.bodySize.y / 2 + 0.5, 0);
        group.add(rotor2);
        group.mainRotor2 = rotor2;

        // Tail rotor
        const tailRotorGeom = new THREE.BoxGeometry(0.05, 1, 0.2);
        const tailRotor = new THREE.Mesh(tailRotorGeom, rotorMat);
        tailRotor.position.set(0.3, 0, -config.bodySize.z);
        group.add(tailRotor);
        group.tailRotor = tailRotor;

        // Skids
        const skidGeom = new THREE.BoxGeometry(0.1, 0.1, config.bodySize.z * 0.6);
        const skidMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        [-config.bodySize.x / 2 - 0.2, config.bodySize.x / 2 + 0.2].forEach(x => {
            const skid = new THREE.Mesh(skidGeom, skidMat);
            skid.position.set(x, -config.bodySize.y / 2 - 0.3, 0);
            group.add(skid);
        });

        return group;
    }

    /**
     * Create hovercraft mesh
     */
    createHovercraftMesh() {
        const group = new THREE.Group();
        const config = this.vehicleConfigs.hovercraft;

        // Hull
        const hullGeom = new THREE.BoxGeometry(
            config.bodySize.x,
            config.bodySize.y,
            config.bodySize.z
        );
        const hullMat = new THREE.MeshStandardMaterial({
            color: 0xff6600,
            roughness: 0.4,
            metalness: 0.5
        });
        const hull = new THREE.Mesh(hullGeom, hullMat);
        hull.position.y = config.bodySize.y / 2;
        hull.castShadow = true;
        group.add(hull);

        // Skirt (inflated)
        const skirtGeom = new THREE.TorusGeometry(
            (config.bodySize.x + config.bodySize.z) / 4,
            config.bodySize.y * 0.3,
            8,
            16
        );
        const skirtMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.9
        });
        const skirt = new THREE.Mesh(skirtGeom, skirtMat);
        skirt.rotation.x = Math.PI / 2;
        skirt.scale.set(config.bodySize.x / ((config.bodySize.x + config.bodySize.z) / 2), 1, config.bodySize.z / ((config.bodySize.x + config.bodySize.z) / 2));
        skirt.position.y = config.bodySize.y * 0.2;
        group.add(skirt);

        // Fan housing
        const fanHousingGeom = new THREE.CylinderGeometry(0.8, 0.8, 1.5, 16);
        const fanHousing = new THREE.Mesh(fanHousingGeom, hullMat);
        fanHousing.position.set(0, config.bodySize.y + 0.75, -config.bodySize.z * 0.3);
        group.add(fanHousing);

        // Fan
        const fanGeom = new THREE.BoxGeometry(1.4, 0.1, 0.2);
        const fanMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
        const fan = new THREE.Mesh(fanGeom, fanMat);
        fan.position.set(0, config.bodySize.y + 1, -config.bodySize.z * 0.3);
        group.add(fan);
        group.fan = fan;

        return group;
    }

    /**
     * Spawn vehicle
     */
    spawnVehicle(entityId, vehicleType, position, rotation) {
        if (this.vehicles.has(entityId)) return;

        const mesh = this.createVehicleMesh(vehicleType);
        mesh.position.set(position.x, position.y, position.z);

        if (rotation) {
            // Convert quaternion to euler
            const euler = new THREE.Euler();
            const quat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
            euler.setFromQuaternion(quat);
            mesh.rotation.copy(euler);
        }

        this.scene.add(mesh);

        this.vehicles.set(entityId, {
            mesh,
            type: vehicleType,
            state: null
        });
    }

    /**
     * Remove vehicle
     */
    removeVehicle(entityId) {
        const vehicle = this.vehicles.get(entityId);
        if (!vehicle) return;

        this.scene.remove(vehicle.mesh);

        // Dispose geometry and materials
        vehicle.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });

        this.vehicles.delete(entityId);

        if (this.localVehicleId === entityId) {
            this.localVehicleId = null;
        }
    }

    /**
     * Update vehicle state from server
     */
    updateVehicleState(state) {
        const vehicle = this.vehicles.get(state.entityId);
        if (!vehicle) {
            // Spawn if doesn't exist
            this.spawnVehicle(state.entityId, state.vehicleType, state.position, state.rotation);
            return;
        }

        const now = performance.now();
        const targetPos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
        const targetQuat = state.rotation ? new THREE.Quaternion(
            state.rotation.x,
            state.rotation.y,
            state.rotation.z,
            state.rotation.w
        ) : vehicle.mesh.quaternion.clone();

        vehicle.smoothing = {
            fromPos: vehicle.mesh.position.clone(),
            toPos: targetPos,
            fromRot: vehicle.mesh.quaternion.clone(),
            toRot: targetQuat,
            velocity: state.velocity ? new THREE.Vector3(state.velocity.x, state.velocity.y, state.velocity.z) : new THREE.Vector3(),
            start: now,
            duration: this.smoothingWindow * 1000
        };

        vehicle.state = state;

        // Animate rotors for helicopter
        if (vehicle.type === 'helicopter' && vehicle.mesh.mainRotor) {
            vehicle.mesh.mainRotor.rotation.y += 0.5;
            vehicle.mesh.mainRotor2.rotation.y += 0.5;
            vehicle.mesh.tailRotor.rotation.x += 0.8;
        }

        // Animate fan for hovercraft
        if (vehicle.type === 'hovercraft' && vehicle.mesh.fan) {
            vehicle.mesh.fan.rotation.y += 0.3;
        }

        // Animate wheels for ground vehicles
        if (vehicle.mesh.wheels && state.velocity) {
            const speed = Math.sqrt(
                state.velocity.x * state.velocity.x +
                state.velocity.z * state.velocity.z
            );
            const wheelConfig = this.vehicleConfigs[vehicle.type];
            if (wheelConfig && wheelConfig.wheelRadius) {
                const rotation = speed * 0.05 / wheelConfig.wheelRadius;
                vehicle.mesh.wheels.forEach(wheel => {
                    wheel.rotation.x += rotation;
                });
            }
        }
    }

    /**
     * Set local vehicle (player is driving)
     */
    setLocalVehicle(entityId) {
        this.localVehicleId = entityId;
    }

    /**
     * Clear local vehicle
     */
    clearLocalVehicle() {
        this.localVehicleId = null;
    }

    /**
     * Handle keyboard input
     */
    handleKeyDown(key) {
        switch (key.toLowerCase()) {
            case 'w': this.keys.forward = true; break;
            case 's': this.keys.backward = true; break;
            case 'a': this.keys.left = true; break;
            case 'd': this.keys.right = true; break;
            case ' ': this.keys.brake = true; break;
            case 'shift': this.keys.handbrake = true; break;
            case 'r': this.keys.up = true; break;
            case 'f': this.keys.down = true; break;
        }
    }

    handleKeyUp(key) {
        switch (key.toLowerCase()) {
            case 'w': this.keys.forward = false; break;
            case 's': this.keys.backward = false; break;
            case 'a': this.keys.left = false; break;
            case 'd': this.keys.right = false; break;
            case ' ': this.keys.brake = false; break;
            case 'shift': this.keys.handbrake = false; break;
            case 'r': this.keys.up = false; break;
            case 'f': this.keys.down = false; break;
        }
    }

    /**
     * Update and send vehicle input
     */
    update(deltaTime) {
        this.applySmoothing();

        if (!this.localVehicleId) return;

        const vehicle = this.vehicles.get(this.localVehicleId);
        if (!vehicle) return;

        // Build input state
        this.inputState.throttle = this.keys.forward ? 1 : (this.keys.backward ? -0.5 : 0);
        this.inputState.brake = this.keys.brake ? 1 : 0;
        this.inputState.steering = (this.keys.left ? -1 : 0) + (this.keys.right ? 1 : 0);
        this.inputState.handbrake = this.keys.handbrake;

        // For aircraft
        if (vehicle.type === 'helicopter') {
            this.inputState.collective = this.keys.forward ? 1 : (this.keys.backward ? 0.3 : 0.5);
            this.inputState.yaw = (this.keys.left ? -1 : 0) + (this.keys.right ? 1 : 0);
            this.inputState.pitch = this.keys.up ? 0.5 : (this.keys.down ? -0.5 : 0);
        }

        // Send input to server
        this.networkClient.sendVehicleInput(this.inputState);
    }

    applySmoothing() {
        const now = performance.now();
        for (const [id, vehicle] of this.vehicles.entries()) {
            if (!vehicle.smoothing) continue;
            if (this.localVehicleId === id) continue;

            const t = Math.min(1, (now - vehicle.smoothing.start) / vehicle.smoothing.duration);
            const eased = t * t * (3 - 2 * t);

            const blendedPos = new THREE.Vector3().copy(vehicle.smoothing.toPos);
            blendedPos.addScaledVector(vehicle.smoothing.velocity, this.smoothingWindow * (1 - eased));
            vehicle.mesh.position.lerpVectors(vehicle.smoothing.fromPos, blendedPos, eased);

            vehicle.mesh.quaternion.slerpQuaternions(vehicle.smoothing.fromRot, vehicle.smoothing.toRot, eased);
        }
    }

    /**
     * Get vehicle mesh
     */
    getVehicleMesh(entityId) {
        const vehicle = this.vehicles.get(entityId);
        return vehicle ? vehicle.mesh : null;
    }

    /**
     * Get local vehicle
     */
    getLocalVehicle() {
        if (!this.localVehicleId) return null;
        return this.vehicles.get(this.localVehicleId);
    }

    /**
     * Check if controlling a vehicle
     */
    isControllingVehicle() {
        return this.localVehicleId !== null;
    }

    /**
     * Dispose all resources
     */
    dispose() {
        for (const entityId of this.vehicles.keys()) {
            this.removeVehicle(entityId);
        }
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.VehicleRenderer = VehicleRenderer;
}
