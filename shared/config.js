/**
 * Shared Configuration for Cyberia 2000 Physics
 * Used by both server and client
 */

export const CONFIG = {
    // World settings
    world: {
        seed: 7777,
        chunkSize: 200,
        terrainResolution: 32, // Vertices per chunk edge for physics
        renderResolution: 64,   // Vertices per chunk edge for rendering
        serverChunkRadius: 3,   // How many chunks around each player the server simulates
        clientChunkRadius: 2,   // How many chunks the client renders
        gravity: -30.0,         // World gravity (m/s²)
        waterLevel: -2
    },

    // Physics settings (Rapier)
    physics: {
        timestep: 1 / 60,       // Fixed physics timestep
        maxSubsteps: 4,         // Max physics substeps per frame
        gravity: { x: 0, y: -30.0, z: 0 },

        // Player capsule
        player: {
            height: 1.7,
            radius: 0.4,
            mass: 80,
            friction: 0.5,
            restitution: 0.0,
            linearDamping: 0.1,
            angularDamping: 0.5
        },

        // Vehicle physics
        vehicle: {
            // Car
            car: {
                chassisMass: 1500,
                chassisSize: { x: 2.0, y: 0.8, z: 4.5 },
                wheelRadius: 0.4,
                wheelWidth: 0.3,
                suspensionRestLength: 0.3,
                suspensionStiffness: 35,
                suspensionDamping: 4.5,
                maxSuspensionForce: 6000,
                frictionSlip: 2.0,
                maxSteerAngle: Math.PI / 6,
                engineForce: 8000,
                brakeForce: 4000
            },
            // Truck
            truck: {
                chassisMass: 4000,
                chassisSize: { x: 2.5, y: 1.2, z: 7.0 },
                wheelRadius: 0.6,
                wheelWidth: 0.4,
                suspensionRestLength: 0.4,
                suspensionStiffness: 45,
                suspensionDamping: 5.5,
                maxSuspensionForce: 15000,
                frictionSlip: 1.5,
                maxSteerAngle: Math.PI / 8,
                engineForce: 15000,
                brakeForce: 8000
            },
            // Motorcycle
            motorcycle: {
                chassisMass: 250,
                chassisSize: { x: 0.5, y: 0.6, z: 2.0 },
                wheelRadius: 0.35,
                wheelWidth: 0.15,
                suspensionRestLength: 0.2,
                suspensionStiffness: 25,
                suspensionDamping: 3.0,
                maxSuspensionForce: 2000,
                frictionSlip: 2.5,
                maxSteerAngle: Math.PI / 4,
                engineForce: 4000,
                brakeForce: 2000
            },
            // Tank
            tank: {
                chassisMass: 50000,
                chassisSize: { x: 3.5, y: 1.5, z: 7.5 },
                trackWidth: 0.8,
                trackLength: 6.5,
                maxSpeed: 15,
                engineForce: 100000,
                turnRate: 0.8,
                friction: 0.9
            },
            // Helicopter
            helicopter: {
                mass: 3000,
                bodySize: { x: 2.5, y: 2.0, z: 8.0 },
                liftForce: 50000,
                maxLiftForce: 80000,
                pitchRate: 1.5,
                rollRate: 1.5,
                yawRate: 2.0,
                linearDamping: 0.3,
                angularDamping: 0.8,
                maxSpeed: 50,
                maxAltitude: 500
            },
            // Hovercraft
            hovercraft: {
                mass: 800,
                bodySize: { x: 3.0, y: 1.0, z: 5.0 },
                hoverHeight: 0.5,
                hoverForce: 15000,
                thrustForce: 8000,
                turnRate: 2.0,
                friction: 0.1,
                linearDamping: 0.5
            }
        },

        // Terrain collider settings
        terrain: {
            friction: 0.8,
            restitution: 0.1
        },

        // Building collider settings
        building: {
            friction: 0.6,
            restitution: 0.0
        }
    },

    // Player movement settings
    movement: {
        walkSpeed: 5.0,
        runSpeed: 10.0,
        crouchSpeed: 2.5,
        jumpForce: 10.0,
        airControl: 0.3,
        maxStamina: 100,
        staminaDrainRate: 15,
        staminaRegenRate: 20,
        turnSpeed: 5.0
    },

    // Network settings
    network: {
        port: 8080,
        tickRate: 30,           // Server ticks per second
        clientSendRate: 30,     // Client input sends per second
        interpolationDelay: 100, // ms delay for interpolation
        maxPredictionTime: 200,  // ms max client prediction
        snapshotBufferSize: 32,  // Number of snapshots to buffer
        inputBufferSize: 64,     // Number of inputs to buffer
        timeout: 10000,          // Connection timeout ms
        reconnectDelay: 2000     // Reconnect attempt delay ms
    },

    // Message types for network protocol
    messageTypes: {
        // Connection
        HANDSHAKE: 'handshake',
        HANDSHAKE_ACK: 'handshake_ack',
        PING: 'ping',
        PONG: 'pong',
        DISCONNECT: 'disconnect',

        // Game state
        WORLD_SNAPSHOT: 'world_snapshot',
        PLAYER_INPUT: 'player_input',
        INPUT_ACK: 'input_ack',

        // Entity management
        ENTITY_SPAWN: 'entity_spawn',
        ENTITY_DESTROY: 'entity_destroy',

        // Vehicle
        VEHICLE_ENTER: 'vehicle_enter',
        VEHICLE_EXIT: 'vehicle_exit',
        VEHICLE_INPUT: 'vehicle_input',

        // Chunk management
        CHUNK_REQUEST: 'chunk_request',
        CHUNK_DATA: 'chunk_data',
        CHUNK_UNLOAD: 'chunk_unload',

        // Chat
        CHAT_MESSAGE: 'chat_message',

        // Events
        GAME_EVENT: 'game_event'
    },

    // Entity types
    entityTypes: {
        PLAYER: 'player',
        VEHICLE: 'vehicle',
        PROJECTILE: 'projectile',
        ITEM: 'item',
        NPC: 'npc',
        BUILDING: 'building'
    },

    // Vehicle types
    vehicleTypes: {
        CAR: 'car',
        TRUCK: 'truck',
        MOTORCYCLE: 'motorcycle',
        TANK: 'tank',
        HELICOPTER: 'helicopter',
        HOVERCRAFT: 'hovercraft'
    },

    // Biomes
    biomes: {
        wasteland: {
            name: 'Wasteland',
            primaryColor: 0xd4a574,
            ambientColor: 0x8b7355,
            fogDensity: 0.002
        },
        marsh: {
            name: 'Marsh',
            primaryColor: 0x4a6741,
            ambientColor: 0x2d4a2d,
            fogDensity: 0.004
        },
        highlands: {
            name: 'Highlands',
            primaryColor: 0x7a8b6e,
            ambientColor: 0x5a6b4e,
            fogDensity: 0.001
        },
        crystal: {
            name: 'Crystal Fields',
            primaryColor: 0x88aacc,
            ambientColor: 0x6688aa,
            fogDensity: 0.002
        },
        oasis: {
            name: 'Oasis',
            primaryColor: 0x8bc34a,
            ambientColor: 0x689f38,
            fogDensity: 0.002
        },
        volcanic: {
            name: 'Volcanic',
            primaryColor: 0xd84315,
            ambientColor: 0x8b2500,
            fogDensity: 0.003
        },
        tundra: {
            name: 'Tundra',
            primaryColor: 0xb0c4de,
            ambientColor: 0x87ceeb,
            fogDensity: 0.001
        },
        jungle: {
            name: 'Jungle',
            primaryColor: 0x228b22,
            ambientColor: 0x006400,
            fogDensity: 0.005
        },
        corrupted: {
            name: 'Corrupted Zone',
            primaryColor: 0x9932cc,
            ambientColor: 0x4b0082,
            fogDensity: 0.004
        },
        bioluminescent: {
            name: 'Bioluminescent',
            primaryColor: 0x00ff88,
            ambientColor: 0x008844,
            fogDensity: 0.003
        }
    },

    // Debug settings
    debug: {
        showPhysicsDebug: false,
        showNetworkStats: true,
        showChunkBorders: false,
        logPhysicsEvents: false,
        logNetworkMessages: false
    }
};

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG };
} else if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}
