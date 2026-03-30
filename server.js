const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const TICK_MS = 100;
const GRID_SIZE = 20;
const MAX_PLAYERS = 2;

const staticFiles = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/game.js": "game.js",
};

const rooms = new Map();

function createServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
    if (pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }

    const fileName = staticFiles[pathname];
    if (!fileName) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const filePath = path.join(__dirname, fileName);
    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("File read failed");
        return;
      }

      response.writeHead(200, { "Content-Type": getContentType(fileName) });
      response.end(content);
    });
  });

  const wss = new WebSocket.Server({ server });

  wss.on("connection", (socket) => {
    socket.clientId = crypto.randomUUID();
    socket.roomCode = null;
    socket.playerId = null;

    socket.on("message", (rawMessage) => {
      let message = null;

      try {
        message = JSON.parse(rawMessage.toString());
      } catch (error) {
        sendError(socket, "Invalid JSON message.");
        return;
      }

      handleMessage(socket, message);
    });

    socket.on("close", () => {
      handleDisconnect(socket);
    });
  });

  server.listen(PORT, () => {
    console.log(`Two-player snake server running at http://localhost:${PORT}`);
  });
}

function getContentType(fileName) {
  if (fileName.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (fileName.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (fileName.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}

function handleMessage(socket, message) {
  switch (message.type) {
    case "ping":
      send(socket, { type: "pong", sentAt: message.sentAt || Date.now() });
      return;
    case "create_room":
      createRoom(socket, message.name);
      return;
    case "join_room":
      joinRoom(socket, message.roomCode, message.name);
      return;
    case "chat_message":
      addChatFromPlayer(socket, message.text);
      return;
    case "toggle_ready":
      toggleReady(socket);
      return;
    case "change_direction":
      changeDirection(socket, message.direction);
      return;
    case "start_game":
      startGame(socket);
      return;
    case "restart_game":
      restartGame(socket);
      return;
    case "leave_room":
      leaveCurrentRoom(socket);
      return;
    default:
      sendError(socket, "Unknown message type.");
  }
}

function createRoom(socket, rawName) {
  leaveCurrentRoom(socket);

  const roomCode = generateRoomCode();
  const room = {
    code: roomCode,
    players: [null, null],
    hostId: null,
    matchState: "waiting",
    winnerId: null,
    food: { x: 10, y: 10 },
    chat: [],
    tickTimer: null,
  };

  rooms.set(roomCode, room);
  addPlayerToRoom(room, socket, sanitizeName(rawName));
  addSystemMessage(room, `${room.players[0].name} 创建了房间。`);
  broadcastRoom(room);
}

function joinRoom(socket, rawRoomCode, rawName) {
  leaveCurrentRoom(socket);

  const roomCode = String(rawRoomCode || "").trim().toUpperCase();
  const room = rooms.get(roomCode);
  if (!room) {
    sendError(socket, "Room not found.");
    return;
  }

  const availableSlot = room.players.findIndex((player) => player === null);
  if (availableSlot === -1) {
    sendError(socket, "Room is full.");
    return;
  }

  addPlayerToRoom(room, socket, sanitizeName(rawName));
  room.matchState = "waiting";
  addSystemMessage(room, `${room.players.filter(Boolean).at(-1).name} 加入了房间。`);
  broadcastRoom(room);
}

function startGame(socket) {
  const room = getSocketRoom(socket);
  if (!room) {
    sendError(socket, "Join a room first.");
    return;
  }

  if (room.hostId !== socket.playerId) {
    sendError(socket, "Only the host can start the match.");
    return;
  }

  if (room.players.filter(Boolean).length !== MAX_PLAYERS) {
    sendError(socket, "Two players are required.");
    return;
  }

  if (!room.players.every((player) => player && player.ready)) {
    sendError(socket, "Both players must be ready.");
    return;
  }

  addSystemMessage(room, "房主开始了对局。");
  initializeMatch(room);
  broadcastRoom(room);
}

function restartGame(socket) {
  const room = getSocketRoom(socket);
  if (!room) {
    sendError(socket, "Join a room first.");
    return;
  }

  if (room.players.filter(Boolean).length !== MAX_PLAYERS) {
    sendError(socket, "Two players are required.");
    return;
  }

  initializeMatch(room);
  broadcastRoom(room);
}

function changeDirection(socket, rawDirection) {
  const room = getSocketRoom(socket);
  if (!room || room.matchState !== "running") {
    return;
  }

  const player = room.players.find((entry) => entry && entry.id === socket.playerId);
  if (!player || !player.alive) {
    return;
  }

  const nextDirection = directionFromName(rawDirection);
  if (!nextDirection) {
    return;
  }

  const reversing =
    nextDirection.x + player.direction.x === 0 &&
    nextDirection.y + player.direction.y === 0 &&
    player.snake.length > 1;

  if (reversing) {
    return;
  }

  player.nextDirection = nextDirection;
}

function toggleReady(socket) {
  const room = getSocketRoom(socket);
  if (!room) {
    sendError(socket, "Join a room first.");
    return;
  }

  if (room.matchState === "running") {
    return;
  }

  const player = room.players.find((entry) => entry && entry.id === socket.playerId);
  if (!player) {
    return;
  }

  player.ready = !player.ready;
  addSystemMessage(room, `${player.name}${player.ready ? " 已准备" : " 取消了准备" }。`);
  broadcastRoom(room);
}

function addChatFromPlayer(socket, rawText) {
  const room = getSocketRoom(socket);
  if (!room) {
    sendError(socket, "Join a room first.");
    return;
  }

  const player = room.players.find((entry) => entry && entry.id === socket.playerId);
  if (!player) {
    return;
  }

  const text = String(rawText || "").trim().slice(0, 120);
  if (!text) {
    return;
  }

  addChatMessage(room, {
    id: crypto.randomUUID(),
    type: "player",
    author: player.name,
    playerId: player.id,
    text,
    createdAt: Date.now(),
  });
  broadcastRoom(room);
}

function handleDisconnect(socket) {
  leaveCurrentRoom(socket);
}

function leaveCurrentRoom(socket) {
  const room = getSocketRoom(socket);
  if (!room) {
    return;
  }

  const index = room.players.findIndex((player) => player && player.id === socket.playerId);
  if (index !== -1) {
    room.players[index] = null;
  }

  socket.roomCode = null;
  socket.playerId = null;

  stopRoomLoop(room);

  const remainingPlayers = room.players.filter(Boolean);
  if (remainingPlayers.length === 0) {
    rooms.delete(room.code);
    return;
  }

  addSystemMessage(room, "有玩家离开了房间。");
  room.hostId = remainingPlayers[0].id;
  room.matchState = "waiting";
  room.winnerId = null;
  remainingPlayers.forEach(resetPlayerForWaitingState);
  room.food = randomFoodPosition(room.players);
  broadcastRoom(room);
}

function addPlayerToRoom(room, socket, name) {
  const slotIndex = room.players.findIndex((player) => player === null);
  const slot = slotIndex + 1;
  const player = {
    id: crypto.randomUUID(),
    slot,
    name,
    socket,
    score: 0,
    ready: false,
    alive: true,
    direction: slot === 1 ? { x: 1, y: 0, name: "right" } : { x: -1, y: 0, name: "left" },
    nextDirection: slot === 1 ? { x: 1, y: 0, name: "right" } : { x: -1, y: 0, name: "left" },
    snake: [],
  };

  room.players[slotIndex] = player;
  room.hostId = room.hostId || player.id;
  socket.roomCode = room.code;
  socket.playerId = player.id;
  resetPlayerForWaitingState(player);
}

function initializeMatch(room) {
  stopRoomLoop(room);

  room.matchState = "running";
  room.winnerId = null;
  room.players.filter(Boolean).forEach((player) => {
    player.score = 0;
    player.ready = false;
    player.alive = true;
    player.direction = player.slot === 1 ? { x: 1, y: 0, name: "right" } : { x: -1, y: 0, name: "left" };
    player.nextDirection = { ...player.direction };
    player.snake = player.slot === 1
      ? [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }]
      : [{ x: 14, y: 10 }, { x: 15, y: 10 }, { x: 16, y: 10 }];
  });
  room.food = randomFoodPosition(room.players);
  room.tickTimer = setInterval(() => stepRoom(room), TICK_MS);
}

function resetPlayerForWaitingState(player) {
  player.score = 0;
  player.ready = false;
  player.alive = true;
  player.direction = player.slot === 1 ? { x: 1, y: 0, name: "right" } : { x: -1, y: 0, name: "left" };
  player.nextDirection = { ...player.direction };
  player.snake = player.slot === 1
    ? [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }]
    : [{ x: 14, y: 10 }, { x: 15, y: 10 }, { x: 16, y: 10 }];
}

function stepRoom(room) {
  if (room.matchState !== "running") {
    return;
  }

  const activePlayers = room.players.filter(Boolean);
  const nextHeads = new Map();

  activePlayers.forEach((player) => {
    if (!player.alive) {
      return;
    }

    player.direction = player.nextDirection;
    const nextHead = {
      x: player.snake[0].x + player.direction.x,
      y: player.snake[0].y + player.direction.y,
    };
    nextHeads.set(player.id, nextHead);
  });

  const deadPlayers = new Set();

  activePlayers.forEach((player) => {
    if (!player.alive) {
      return;
    }

    const head = nextHeads.get(player.id);
    if (!head) {
      return;
    }

    const hitWall = head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE;
    if (hitWall) {
      deadPlayers.add(player.id);
      return;
    }

    const hitBody = activePlayers.some((otherPlayer) => {
      const body = otherPlayer.id === player.id ? otherPlayer.snake.slice(0, -1) : otherPlayer.snake;
      return body.some((segment) => segment.x === head.x && segment.y === head.y);
    });

    if (hitBody) {
      deadPlayers.add(player.id);
    }
  });

  if (activePlayers.length === 2) {
    const first = activePlayers[0];
    const second = activePlayers[1];
    const firstHead = nextHeads.get(first.id);
    const secondHead = nextHeads.get(second.id);

    if (firstHead && secondHead && firstHead.x === secondHead.x && firstHead.y === secondHead.y) {
      deadPlayers.add(first.id);
      deadPlayers.add(second.id);
    }
  }

  activePlayers.forEach((player) => {
    if (!player.alive || deadPlayers.has(player.id)) {
      player.alive = false;
      return;
    }

    const nextHead = nextHeads.get(player.id);
    player.snake.unshift(nextHead);

    if (nextHead.x === room.food.x && nextHead.y === room.food.y) {
      player.score += 10;
      room.food = randomFoodPosition(room.players);
    } else {
      player.snake.pop();
    }
  });

  if (deadPlayers.size > 0) {
    finishMatch(room);
  }

  broadcastRoom(room);
}

function finishMatch(room) {
  room.matchState = "finished";
  stopRoomLoop(room);

  const survivors = room.players.filter((player) => player && player.alive);
  room.winnerId = survivors.length === 1 ? survivors[0].id : null;
  addSystemMessage(room, room.winnerId ? `${survivors[0].name} 赢得了本局。` : "本局平局。");
}

function stopRoomLoop(room) {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

function broadcastRoom(room) {
  const payload = {
    roomCode: room.code,
    hostId: room.hostId,
    matchState: room.matchState,
    winnerId: room.winnerId,
    food: room.food,
    chat: room.chat,
    players: room.players.map((player) => {
      if (!player) {
        return null;
      }

      return {
        id: player.id,
        slot: player.slot,
        name: player.name,
        score: player.score,
        ready: player.ready,
        alive: player.alive,
        direction: player.direction,
        snake: player.snake,
      };
    }),
  };

  room.players.filter(Boolean).forEach((player) => {
    send(player.socket, {
      type: "room_state",
      payload: {
        ...payload,
        yourPlayerId: player.id,
      },
    });
  });
}

function addSystemMessage(room, text) {
  addChatMessage(room, {
    id: crypto.randomUUID(),
    type: "system",
    author: "系统",
    playerId: null,
    text,
    createdAt: Date.now(),
  });
}

function addChatMessage(room, message) {
  room.chat.push(message);
  if (room.chat.length > 20) {
    room.chat.shift();
  }
}

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function sendError(socket, message) {
  send(socket, { type: "error", message });
}

function getSocketRoom(socket) {
  if (!socket.roomCode) {
    return null;
  }

  return rooms.get(socket.roomCode) || null;
}

function sanitizeName(value) {
  const name = String(value || "").trim().slice(0, 16);
  return name || "Player";
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = "";
    for (let index = 0; index < 6; index += 1) {
      const randomIndex = Math.floor(Math.random() * alphabet.length);
      code += alphabet[randomIndex];
    }
  } while (rooms.has(code));

  return code;
}

function randomFoodPosition(players) {
  let position = { x: 0, y: 0 };

  do {
    position = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    };
  } while (
    players
      .filter(Boolean)
      .some((player) => player.snake.some((segment) => segment.x === position.x && segment.y === position.y))
  );

  return position;
}

function directionFromName(name) {
  const mapping = {
    up: { x: 0, y: -1, name: "up" },
    down: { x: 0, y: 1, name: "down" },
    left: { x: -1, y: 0, name: "left" },
    right: { x: 1, y: 0, name: "right" },
  };

  return mapping[String(name || "").toLowerCase()] || null;
}

createServer();
