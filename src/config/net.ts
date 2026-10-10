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

/**
 * The game's side of online play (src/net): connecting, predicting the own hole, drawing everything else a little in
 * the past, and falling back to the offline arena. Times are real seconds. Not part of the shared rules (the server
 * does not read these).
 */
export const NET_CLIENT = {
  /**
   * Seconds to connect and be welcomed before the game falls back to the offline arena (a refused connection or a
   * proxy with no server behind it fails at once; this is for a link that never answers).
   */
  connectSeconds: 10,
  /**
   * An open connection that delivers nothing for this long is treated as dropped (snapshots come 20 times a second;
   * a phone between cells can go quiet for a few seconds and recover).
   */
  stallSeconds: 8,
  /** Seconds between pings (the round trip time on screen). */
  pingSeconds: 1,
  /**
   * Input goes out at most once a frame and every this many steps (30 a second at 60 steps): NET.limits counts every
   * message. The own hole is predicted with the input as sent, so prediction and server steer it alike.
   */
  inputSteps: 2,
  /** Other holes are drawn this far behind the newest snapshot (two snapshots of slack for late ones). */
  interpDelay: 0.1,
  /** Past their newest snapshot other holes carry on along their last motion for at most this long, then wait. */
  maxExtrapolate: 0.05,
  /** Snapshots whose arrival times set the server clock (the earliest arrival in the window wins: the least delayed). */
  clockWindow: 40,
  /** The drawing clock eases toward a new server clock at most this fast (a fraction of real time), and jumps past this many steps. */
  clockSlew: 0.1,
  clockJumpSteps: 30,
  /** Prediction replays at most this many steps after a snapshot (a slower link plays with less prediction). */
  maxReplaySteps: 60,
  /**
   * The lead between the own prediction and the server's steps moves by one only after this many snapshots in a row
   * disagree with it (network jitter), at once when they disagree by `leadJump` steps or more (a stall).
   */
  leadStreak: 3,
  leadJump: 3,
  /** A correction of the own hole fades out with this time constant; one bigger than snapViews view distances snaps. */
  correctionTime: 0.1,
  snapViews: 0.3,
  /** The prediction clock runs at most this much time in one frame; a longer stall is skipped. */
  maxFrameSeconds: 0.25,
  /** Queued snapshots past this (a hidden tab draws no frames) are applied at once, their effects dropped. */
  maxQueued: 60,
  /** Play again goes out this long after the life ended (the server takes it after NET.limits.playAgainDelay), and again every playAgainRetry until a new life starts. */
  playAgainDelay: 0.6,
  playAgainRetry: 1.5,
  /** Seconds between refreshes of the players online on the title screen. */
  onlineRefreshSeconds: 10,
  /** Seconds a note (fallback to the offline arena, refused nickname) stays on screen. */
  noteSeconds: 6,
  /** After a reload for a new version, another 'version' refusal within this many seconds plays offline instead (no reload loop). */
  reloadGuardSeconds: 60,
  /** Ping colours on screen: good below this many milliseconds, fair below the next, poor above. */
  pingGood: 100,
  pingFair: 200,
} as const;
