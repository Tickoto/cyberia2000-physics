# Cyberia 2000 - Networked Physics Edition

A multiplayer physics-based game using **Rapier physics engine** with server-authoritative networked physics simulation.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    PHYSICS SERVER                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Rapier Physics World                  │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────────────┐  │   │
│  │  │  Player   │ │  Vehicle  │ │  Terrain Chunks   │  │   │
│  │  │  Bodies   │ │  Bodies   │ │  (Heightfields)   │  │   │
│  │  └───────────┘ └───────────┘ └───────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                   Physics Step @ 60Hz                        │
│                          │                                   │
│                   World Snapshots @ 30Hz                     │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              WebSocket Server (Port 8080)            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   CLIENT 1      │ │   CLIENT 2      │ │   CLIENT N      │
│ ┌─────────────┐ │ │ ┌─────────────┐ │ │ ┌─────────────┐ │
│ │ Three.js    │ │ │ │ Three.js    │ │ │ │ Three.js    │ │
│ │ Rendering   │ │ │ │ Rendering   │ │ │ │ Rendering   │ │
│ └─────────────┘ │ │ └─────────────┘ │ │ └─────────────┘ │
│ ┌─────────────┐ │ │ ┌─────────────┐ │ │ ┌─────────────┐ │
│ │ Client-side │ │ │ │ Client-side │ │ │ │ Client-side │ │
│ │ Prediction  │ │ │ │ Prediction  │ │ │ │ Prediction  │ │
│ └─────────────┘ │ │ └─────────────┘ │ │ └─────────────┘ │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## Features

### Server-Side Physics
- **Rapier 3D Physics Engine** - Fast, deterministic physics simulation
- **Infinite Procedural Terrain** - Heightfield colliders generated on-demand
- **Dynamic Chunk Loading** - Terrain chunks load/unload based on player positions
- **Building Colliders** - Procedurally generated city buildings with collision

### Vehicle Physics
- **Cars** - Wheeled vehicle simulation with suspension
- **Trucks** - Heavy vehicles with 6 wheels
- **Motorcycles** - Two-wheeled physics
- **Tanks** - Tracked vehicle with turret
- **Helicopters** - Flight physics with lift/pitch/roll/yaw
- **Hovercrafts** - Air cushion vehicle physics

### Networking
- **Server-Authoritative** - Server is the source of truth for all physics
- **Client-Side Prediction** - Responsive movement with server reconciliation
- **State Interpolation** - Smooth rendering of remote entities
- **Input Buffering** - Handles network jitter and latency

### Terrain Generation
- **Procedural Noise** - Multi-octave Perlin noise terrain
- **Biome System** - 10 unique biomes with different characteristics
- **City Generation** - Villages, towns, cities, and megacities
- **Building Placement** - Procedural building generation in urban areas

## Project Structure

```
cyberia2000-physics/
├── index.html              # Main client HTML
├── package.json            # Root package.json
├── shared/                 # Shared code (server + client)
│   ├── config.js          # Game configuration
│   └── terrain-noise.js   # Procedural terrain generation
├── server/                 # Physics server
│   ├── package.json       # Server dependencies
│   ├── physics-server.js  # Main server entry point
│   ├── physics-world.js   # Rapier world wrapper
│   ├── terrain-physics.js # Terrain collider management
│   ├── vehicle-physics.js # Vehicle simulation
│   └── player-physics.js  # Player physics
└── js/                     # Client-side code
    ├── game-client.js     # Main client entry point
    ├── network-client.js  # WebSocket networking
    ├── terrain-renderer.js # Terrain mesh rendering
    ├── vehicle-renderer.js # Vehicle rendering
    └── player-controller.js # Player input & prediction
```

## Installation

### Server Setup

```bash
# Navigate to server directory
cd server

# Install dependencies (includes Rapier physics)
npm install

# Start the physics server
npm start
```

### Client Setup

The client runs in the browser and doesn't require building. Simply serve the files:

```bash
# From root directory, serve with any static file server
npx http-server . -p 3000

# Or use Python
python -m http.server 3000
```

### Quick Start

```bash
# Install all dependencies
npm run server:install

# Start the server
npm run server

# In another terminal, serve the client
npm run client
```

Then open `http://localhost:3000` in your browser.

## Configuration

Edit `shared/config.js` to customize:

### Physics Settings
```javascript
physics: {
    gravity: { x: 0, y: -30.0, z: 0 },
    player: {
        height: 1.7,
        radius: 0.4,
        mass: 80
    },
    vehicle: {
        car: { chassisMass: 1500, engineForce: 8000, ... },
        helicopter: { mass: 3000, liftForce: 50000, ... }
    }
}
```

### Network Settings
```javascript
network: {
    port: 8080,
    tickRate: 30,           // Server updates per second
    interpolationDelay: 100  // ms delay for smooth rendering
}
```

### World Settings
```javascript
world: {
    seed: 7777,
    chunkSize: 200,
    serverChunkRadius: 3,   // Chunks simulated around players
    clientChunkRadius: 2    // Chunks rendered on client
}
```

## Controls

| Key | Action |
|-----|--------|
| W/A/S/D | Move |
| Space | Jump |
| Shift | Sprint |
| Ctrl | Crouch |
| F | Enter/Exit Vehicle |
| E | Interact |
| Mouse | Look around |
| Click | Lock cursor |

### Vehicle Controls
| Key | Action |
|-----|--------|
| W/S | Throttle/Reverse |
| A/D | Steering |
| Space | Brake |
| Shift | Handbrake |
| R/F | Helicopter Up/Down |

## Network Protocol

### Message Types
- `HANDSHAKE` / `HANDSHAKE_ACK` - Connection establishment
- `PLAYER_INPUT` - Client sends inputs to server
- `WORLD_SNAPSHOT` - Server broadcasts game state
- `VEHICLE_ENTER` / `VEHICLE_EXIT` - Vehicle interactions
- `CHUNK_REQUEST` / `CHUNK_DATA` - Terrain streaming
- `CHAT_MESSAGE` - Player chat

### State Synchronization
1. Client sends input with sequence number
2. Server processes input and steps physics
3. Server broadcasts world snapshot with last processed input seq
4. Client reconciles predicted state with server state
5. Client re-applies unacknowledged inputs

## Performance

### Server
- Physics runs at 60Hz internally
- Network updates at 30Hz (configurable)
- Terrain chunks loaded within 3-chunk radius of players
- Old chunks unloaded to manage memory

### Client
- Render at display refresh rate
- Client-side prediction for responsive movement
- State interpolation for smooth remote entity movement
- Terrain chunks rendered within 2-chunk radius

## License

MIT
