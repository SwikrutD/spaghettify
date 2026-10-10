/**
 * Online play: the WebSocket arena on the Node server. Each room runs the shared simulation (src/sim) at
 * SIM.tickRate, exactly like the offline arena, and sends each client a snapshot of what is near it `snapshotRate`
 * times a second. Times are real seconds.
 */
export const NET = {
  /** WebSocket path (Caddy proxies it to the api container; see Caddyfile). */
  path: '/ws',
  /** Snapshots per second. The world steps SIM.tickRate times a second, so a snapshot normally covers 3 steps. */
  snapshotRate: 20,
  /** A stalled server catches up at most this many steps in one go and drops the rest (the arena slows down instead). */
  maxCatchUpSteps: 15,
  rooms: {
    /** Holes a room aims for: bots fill it up to this, and step aside as players join. */
    population: 12,
    /** Players a room takes at most (quick play opens another room when every room is full). */
    maxPlayers: 12,
    /** Bots a room keeps however many players there are. */
    minBots: 0,
    /** Rooms the server runs at most; past that quick play says the server is full. */
    maxRooms: 8,
    /** A room with no players is closed after this many seconds (so someone who rejoins at once finds it again). */
    emptySeconds: 60,
  },
  interest: {
    /**
     * A client gets what lies within `reach` view distances of its hole (radius alone), plus `margin`. The client
     * says how far its screen reaches (its farthest ground corner, in view distances: about 1.3 on a wide screen,
     * 2.4 on a portrait phone); it is clamped to reachMin..reachMax, and is reachMax until it says.
     */
    reachMin: 1.2,
    reachMax: 2.6,
    margin: 0.25,
    /** Things are forgotten once beyond this many times the interest radius (no flicker at the rim). */
    leaveFactor: 1.15,
    /** Holes are sent while within the interest radius plus this many of their own radii (their disks reach out). */
    holeMargin: 3,
    /** Comets are sent from this many of their radii (plus their tail) outside the interest radius. */
    cometMargin: 12,
    /**
     * A field layer is kept in sync while its biggest grains are at least this fraction of the client's view distance
     * (about 2 pixels across on a 720p screen); smaller ones are not drawn online. It stops below `layerHysteresis` of that.
     */
    fieldMinSize: 0.002,
    layerHysteresis: 0.8,
  },
  limits: {
    /** Largest message a client may send (bytes); bigger closes the connection. */
    maxMessageBytes: 512,
    /** Messages per second a client may send on average, and the burst it may save up. Past it messages are dropped. */
    messagesPerSecond: 40,
    burst: 80,
    /** Dropped messages (rate, malformed or out of place) a connection may rack up before it is closed. */
    maxStrikes: 200,
    /** Open connections per IP address, and new connections per IP a minute. */
    connectionsPerIp: 6,
    connectsPerMinute: 30,
    /** Seconds to send a join after connecting. */
    joinSeconds: 10,
    /**
     * Bytes of snapshots a client may leave unread. Past `skipBytes` it is sent no snapshot until it catches up (it
     * gets the whole field around it again afterwards); past `maxBufferedBytes` it is too far behind and is let go.
     */
    skipBytes: 32 * 1024,
    maxBufferedBytes: 256 * 1024,
    /** Seconds between WebSocket pings; a client that misses one is dropped. */
    pingSeconds: 15,
    /** Seconds after a life ends before Play again is taken. */
    playAgainDelay: 0.5,
    /** A player whose life is over and who does not play again within this many seconds is let go. */
    idleDeadSeconds: 300,
  },
  /** Seconds between live top 10 updates, and its rows. */
  boardInterval: 1,
  boardRows: 10,
  /** Lives that end with fewer points than this are not posted to the leaderboard. */
  minPostScore: 1,
} as const;
