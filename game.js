const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const highScoreEl = document.getElementById("high-score");
const speedEl = document.getElementById("speed");
const statusTextEl = document.getElementById("status-text");
const startButton = document.getElementById("start-button");
const pauseButton = document.getElementById("pause-button");
const restartButton = document.getElementById("restart-button");
const audioButton = document.getElementById("audio-button");
const createRoomButton = document.getElementById("create-room-button");
const joinRoomButton = document.getElementById("join-room-button");
const copyRoomButton = document.getElementById("copy-room-button");
const leaveRoomButton = document.getElementById("leave-room-button");
const nicknameInput = document.getElementById("nickname-input");
const roomCodeInput = document.getElementById("room-code-input");
const connectionBadge = document.getElementById("connection-badge");
const modeLabel = document.getElementById("mode-label");
const roomCodeDisplay = document.getElementById("room-code-display");
const roomStateBadge = document.getElementById("room-state-badge");
const playerOneNameEl = document.getElementById("player-one-name");
const playerTwoNameEl = document.getElementById("player-two-name");
const playerOneScoreEl = document.getElementById("player-one-score");
const playerTwoScoreEl = document.getElementById("player-two-score");
const chatLogEl = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const chatSendButton = document.getElementById("chat-send-button");
const readyHintEl = document.getElementById("ready-hint");
const touchButtons = document.querySelectorAll("[data-direction]");

const gridSize = 20;
const tileSize = canvas.width / gridSize;
const baseDelay = 160;
const onlineTickDelay = 100;
const storageKey = "snake-high-score";
const nicknameStorageKey = "snake-online-nickname";
const fruitTypes = [
  { kind: "apple", label: "苹果", score: 10, color: "#ff5f5f" },
  { kind: "pear", label: "青梨", score: 18, color: "#8dc63f" },
  { kind: "berry", label: "莓果", score: 26, color: "#6d5dfc" },
];

const directionMap = {
  ArrowUp: { x: 0, y: -1, name: "up" },
  ArrowDown: { x: 0, y: 1, name: "down" },
  ArrowLeft: { x: -1, y: 0, name: "left" },
  ArrowRight: { x: 1, y: 0, name: "right" },
};

const snakeThemes = {
  solo: {
    bodyStart: "#6ebf72",
    bodyMid: "#397d43",
    bodyEnd: "#214d2a",
    tail: "#2a5b31",
    headStart: "#a3db82",
    headMid: "#4c8e47",
    headEnd: "#264f2a",
  },
  player1: {
    bodyStart: "#7ab8ff",
    bodyMid: "#4577d7",
    bodyEnd: "#1f438f",
    tail: "#274d9b",
    headStart: "#cbe3ff",
    headMid: "#5d8ff0",
    headEnd: "#244b96",
  },
  player2: {
    bodyStart: "#ffb29f",
    bodyMid: "#d76b51",
    bodyEnd: "#8f3321",
    tail: "#9b3d28",
    headStart: "#ffd5cb",
    headMid: "#ef896f",
    headEnd: "#983929",
  },
};

const soloStartSnake = [
  { x: 10, y: 10 },
  { x: 9, y: 10 },
  { x: 8, y: 10 },
];

const musicPattern = [
  { note: 392.0, length: 240, gain: 0.018 },
  { note: 523.25, length: 240, gain: 0.02 },
  { note: 587.33, length: 240, gain: 0.018 },
  { note: 523.25, length: 240, gain: 0.02 },
  { note: 659.25, length: 360, gain: 0.018 },
  { note: 587.33, length: 260, gain: 0.018 },
];

let highScore = Number(localStorage.getItem(storageKey) || 0);
let audioEnabled = true;
let audioContext = null;
let musicTimer = null;
let musicStep = 0;
let mode = "solo";
let socket = null;
let lastRenderedChatId = "";
let animationFrameId = 0;

let soloState = createSoloState();
let onlineState = createInitialOnlineState();
let lastAudioSnapshot = { status: "idle", myScore: 0 };

nicknameInput.value = localStorage.getItem(nicknameStorageKey) || "";
applyInviteCodeFromUrl();

function createSoloState() {
  return {
    snake: soloStartSnake.map(cloneSegment),
    direction: directionMap.ArrowRight,
    nextDirection: directionMap.ArrowRight,
    fruits: [],
    bombs: [],
    score: 0,
    tickDelay: baseDelay,
    gameLoop: null,
    isRunning: false,
    isPaused: false,
  };
}

function createInitialOnlineState() {
  return {
    connectionStatus: "offline",
    roomCode: "",
    myPlayerId: null,
    hostId: null,
    players: [],
    snakes: [],
    fruits: [],
    bombs: [],
    status: "idle",
    winnerId: null,
    chat: [],
    previousSnakes: [],
    stateUpdatedAt: performance.now(),
  };
}

function cloneSegment(segment) {
  return { x: segment.x, y: segment.y };
}

function positionKey(segment) {
  return `${segment.x},${segment.y}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(items) {
  const cloned = items.slice();
  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cloned[index], cloned[swapIndex]] = [cloned[swapIndex], cloned[index]];
  }
  return cloned;
}

function randomEmptyPosition(occupied) {
  let position = { x: 0, y: 0 };
  let key = "";

  do {
    position = {
      x: Math.floor(Math.random() * gridSize),
      y: Math.floor(Math.random() * gridSize),
    };
    key = positionKey(position);
  } while (occupied.has(key));

  occupied.add(key);
  return position;
}

function generateItems(excludedSegments) {
  const occupied = new Set(excludedSegments.map(positionKey));
  const fruitCount = randomInt(1, 2);
  const bombCount = randomInt(1, 2);
  const fruits = shuffle(fruitTypes)
    .slice(0, fruitCount)
    .map((fruitType) => ({
      kind: fruitType.kind,
      label: fruitType.label,
      score: fruitType.score,
      color: fruitType.color,
      ...randomEmptyPosition(occupied),
    }));
  const bombs = Array.from({ length: bombCount }, () => randomEmptyPosition(occupied));
  return { fruits, bombs };
}

function applyInviteCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (room) {
    roomCodeInput.value = room.toUpperCase().slice(0, 6);
  }
}

function setInviteUrl(roomCode) {
  const url = new URL(window.location.href);
  if (roomCode) {
    url.searchParams.set("room", roomCode);
  } else {
    url.searchParams.delete("room");
  }
  window.history.replaceState({}, "", url);
}

function setStatus(text) {
  statusTextEl.textContent = text;
}

function ensureAudioContext() {
  if (!audioEnabled) {
    return null;
  }

  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      audioEnabled = false;
      updateAudioButton();
      return null;
    }
    audioContext = new AudioCtx();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

function playTone(frequency, duration, options = {}) {
  const context = ensureAudioContext();
  if (!context) {
    return;
  }

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const start = context.currentTime;
  const attack = options.attack ?? 0.01;
  const release = options.release ?? 0.08;
  const volume = options.gain ?? 0.03;

  oscillator.type = options.type ?? "triangle";
  oscillator.frequency.setValueAtTime(frequency, start);
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.exponentialRampToValueAtTime(volume, start + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration + release);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + release + 0.02);
}

function playEatSound() {
  playTone(880, 0.07, { gain: 0.04, type: "square", release: 0.05 });
  setTimeout(() => playTone(1174.66, 0.06, { gain: 0.03, type: "square", release: 0.05 }), 40);
}

function playCrashSound() {
  playTone(220, 0.12, { gain: 0.045, type: "sawtooth", release: 0.12 });
  setTimeout(() => playTone(164.81, 0.18, { gain: 0.04, type: "sawtooth", release: 0.18 }), 80);
}

function playPauseSound(paused) {
  playTone(paused ? 330 : 440, 0.06, { gain: 0.025 });
}

function playStartSound() {
  playTone(523.25, 0.08, { gain: 0.03 });
  setTimeout(() => playTone(659.25, 0.08, { gain: 0.03 }), 70);
}

function stopMusic() {
  if (musicTimer) {
    clearTimeout(musicTimer);
    musicTimer = null;
  }
}

function scheduleMusic() {
  stopMusic();

  if (!audioEnabled) {
    return;
  }

  if (mode === "solo") {
    if (!soloState.isRunning || soloState.isPaused) {
      return;
    }
  } else if (onlineState.status !== "running") {
    return;
  }

  const note = musicPattern[musicStep % musicPattern.length];
  musicStep += 1;
  playTone(note.note, note.length / 1000, { gain: note.gain, type: "triangle", release: 0.1 });
  musicTimer = setTimeout(scheduleMusic, note.length);
}

function updateAudioButton() {
  audioButton.textContent = audioEnabled ? "音乐: 开" : "音乐: 关";
}

function getCellCenter(segment) {
  return {
    x: segment.x * tileSize + tileSize / 2,
    y: segment.y * tileSize + tileSize / 2,
  };
}

function drawBackground() {
  ctx.fillStyle = "#f3f5f7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#d5dbe3";
  ctx.lineWidth = 1;
  for (let offset = tileSize; offset < canvas.width; offset += tileSize) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, offset);
    ctx.lineTo(canvas.width, offset);
    ctx.stroke();
  }
}

function drawFruit(fruit) {
  const padding = tileSize * 0.18;
  const size = tileSize - padding * 2;
  const x = fruit.x * tileSize + padding;
  const y = fruit.y * tileSize + padding;

  ctx.fillStyle = fruit.color;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = "#16181d";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);

  ctx.fillStyle = "#16181d";
  ctx.font = "bold 10px 'Segoe UI', 'Microsoft YaHei', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(fruit.score), x + size / 2, y + size / 2 + 0.5);
}

function drawBomb(bomb) {
  const padding = tileSize * 0.15;
  const size = tileSize - padding * 2;
  const x = bomb.x * tileSize + padding;
  const y = bomb.y * tileSize + padding;

  ctx.fillStyle = "#111111";
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = "#ffcf33";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);

  ctx.fillStyle = "#ffcf33";
  ctx.font = "bold 14px 'Segoe UI Symbol', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", x + size / 2, y + size / 2 + 1);
}

function drawBodySegment(segment, index, totalLength, theme) {
  const center = getCellCenter(segment);
  const progress = index / Math.max(1, totalLength - 1);
  const size = tileSize * (0.7 - progress * 0.12);

  ctx.fillStyle = progress > 0.7 ? theme.bodyEnd : progress > 0.35 ? theme.bodyMid : theme.bodyStart;
  ctx.fillRect(center.x - size / 2, center.y - size / 2, size, size);
  ctx.strokeStyle = "#16181d";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(center.x - size / 2, center.y - size / 2, size, size);
}

function drawHead(snake, direction, theme) {
  if (!snake.length) {
    return;
  }

  const head = snake[0];
  const center = getCellCenter(head);
  const headRadius = tileSize * 0.42;
  const angle = Math.atan2(direction.y, direction.x);

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);

  ctx.fillStyle = theme.headMid;
  ctx.fillRect(-headRadius, -headRadius * 0.78, headRadius * 2, headRadius * 1.56);
  ctx.strokeStyle = "#16181d";
  ctx.lineWidth = 2;
  ctx.strokeRect(-headRadius, -headRadius * 0.78, headRadius * 2, headRadius * 1.56);

  ctx.fillStyle = "#141814";
  ctx.fillRect(headRadius * 0.28, -headRadius * 0.42, 3.2, 3.2);
  ctx.fillRect(headRadius * 0.28, headRadius * 0.22, 3.2, 3.2);
  ctx.restore();
}

function drawTail(snake, theme) {
  if (snake.length < 2) {
    return;
  }

  const tail = snake[snake.length - 1];
  const beforeTail = snake[snake.length - 2];
  const center = getCellCenter(tail);
  const dx = tail.x - beforeTail.x;
  const dy = tail.y - beforeTail.y;
  const angle = Math.atan2(dy, dx);
  const tailRadius = tileSize * 0.2;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.fillStyle = theme.tail;
  ctx.beginPath();
  ctx.moveTo(-tailRadius, -tailRadius);
  ctx.quadraticCurveTo(tailRadius * 1.8, 0, -tailRadius, tailRadius);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSnakeEntity(entity) {
  entity.snake.slice().reverse().forEach((segment, reverseIndex) => {
    const index = entity.snake.length - 1 - reverseIndex;
    if (index !== 0) {
      drawBodySegment(segment, index, entity.snake.length, entity.theme);
    }
  });
  drawTail(entity.snake, entity.theme);
  drawHead(entity.snake, entity.direction, entity.theme);
}

function getRenderState() {
  if (mode === "online") {
    return { fruits: onlineState.fruits, bombs: onlineState.bombs, snakes: getInterpolatedOnlineSnakes() };
  }
  return {
    fruits: soloState.fruits,
    bombs: soloState.bombs,
    snakes: [{ snake: soloState.snake, direction: soloState.direction, theme: snakeThemes.solo }],
  };
}

function interpolateValue(start, end, progress) {
  return start + (end - start) * progress;
}

function interpolateSegment(previousSegment, currentSegment, progress) {
  if (!previousSegment || !currentSegment) {
    return currentSegment ? cloneSegment(currentSegment) : null;
  }

  return {
    x: interpolateValue(previousSegment.x, currentSegment.x, progress),
    y: interpolateValue(previousSegment.y, currentSegment.y, progress),
  };
}

function getInterpolatedOnlineSnakes() {
  const progress = Math.min(1, Math.max(0, (performance.now() - onlineState.stateUpdatedAt) / onlineTickDelay));

  return onlineState.snakes.map((snake) => {
    const previousSnake = onlineState.previousSnakes.find((entry) => entry.id === snake.id);
    if (!previousSnake || previousSnake.snake.length !== snake.snake.length) {
      return snake;
    }

    return {
      ...snake,
      snake: snake.snake.map((segment, index) => interpolateSegment(previousSnake.snake[index], segment, progress)),
    };
  });
}

function draw() {
  const renderState = getRenderState();
  drawBackground();
  renderState.bombs.forEach(drawBomb);
  renderState.fruits.forEach(drawFruit);
  renderState.snakes.forEach(drawSnakeEntity);
}

function startRenderLoop() {
  if (animationFrameId) {
    return;
  }

  const renderFrame = () => {
    draw();
    animationFrameId = window.requestAnimationFrame(renderFrame);
  };

  animationFrameId = window.requestAnimationFrame(renderFrame);
}

function maybeUpdateHighScore(score) {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem(storageKey, String(highScore));
  }
}

function restartSoloLoop() {
  clearInterval(soloState.gameLoop);
  soloState.gameLoop = setInterval(stepSolo, soloState.tickDelay);
}

function resetSoloGame() {
  clearInterval(soloState.gameLoop);
  soloState = createSoloState();
  Object.assign(soloState, generateItems(soloState.snake));
  stopMusic();
  musicStep = 0;
  lastAudioSnapshot = { status: "idle", myScore: 0 };
  updateHud();
  setStatus("单机模式已重置，点击开始后用方向键控制。");
  draw();
}

function endSoloGame() {
  clearInterval(soloState.gameLoop);
  soloState.gameLoop = null;
  soloState.isRunning = false;
  soloState.isPaused = false;
  stopMusic();
  maybeUpdateHighScore(soloState.score);
  updateHud();
  playCrashSound();
  setStatus(`游戏结束，得分 ${soloState.score}。点击重新开始继续。`);
}

function startSoloGame() {
  if (mode !== "solo") {
    if (onlineState.roomCode) {
      if (!isHost()) {
        setStatus("只有房主可以开始对局。");
        return;
      }
      sendMessage({ type: "start_game" });
    }
    return;
  }

  if (soloState.isRunning && !soloState.isPaused) {
    return;
  }

  if (!soloState.isRunning) {
    ensureAudioContext();
    soloState.isRunning = true;
    soloState.isPaused = false;
    restartSoloLoop();
    scheduleMusic();
    playStartSound();
    setStatus("单机游戏进行中。");
  } else {
    togglePause();
  }

  updateHud();
}

function togglePause() {
  if (mode !== "solo") {
    setStatus("联机模式不能暂停。");
    return;
  }
  if (!soloState.isRunning) {
    return;
  }

  soloState.isPaused = !soloState.isPaused;

  if (soloState.isPaused) {
    clearInterval(soloState.gameLoop);
    stopMusic();
    playPauseSound(true);
    setStatus("已暂停，按空格或点击按钮继续。");
  } else {
    restartSoloLoop();
    scheduleMusic();
    playPauseSound(false);
    setStatus("继续前进。");
  }

  updateHud();
}

function setSoloDirection(next) {
  if (!next) {
    return;
  }

  const reversing =
    next.x + soloState.direction.x === 0 &&
    next.y + soloState.direction.y === 0 &&
    soloState.snake.length > 1;

  if (reversing) {
    return;
  }

  soloState.nextDirection = next;

  if (!soloState.isRunning) {
    startSoloGame();
  }
}

function stepSolo() {
  soloState.direction = soloState.nextDirection;

  const head = {
    x: soloState.snake[0].x + soloState.direction.x,
    y: soloState.snake[0].y + soloState.direction.y,
  };

  const hitWall = head.x < 0 || head.x >= gridSize || head.y < 0 || head.y >= gridSize;
  const hitSelf = soloState.snake.some((segment) => segment.x === head.x && segment.y === head.y);
  const hitBomb = soloState.bombs.some((bomb) => bomb.x === head.x && bomb.y === head.y);

  if (hitWall || hitSelf || hitBomb) {
    draw();
    endSoloGame();
    return;
  }

  soloState.snake.unshift(head);

  const eatenFruit = soloState.fruits.find((fruit) => fruit.x === head.x && fruit.y === head.y);
  if (eatenFruit) {
    soloState.score += eatenFruit.score;
    soloState.tickDelay = Math.max(70, soloState.tickDelay - 6);
    maybeUpdateHighScore(soloState.score);
    Object.assign(soloState, generateItems(soloState.snake));
    restartSoloLoop();
    scheduleMusic();
    playEatSound();
    setStatus(`吃到${eatenFruit.label}，获得 ${eatenFruit.score} 分。`);
  } else {
    soloState.snake.pop();
  }

  updateHud();
  draw();
}

function setConnectionStatus(status, text) {
  onlineState.connectionStatus = status;
  connectionBadge.classList.remove("offline", "online");
  connectionBadge.classList.add(status === "online" ? "online" : "offline");
  connectionBadge.textContent = text;
}

function getNickname() {
  const nickname = nicknameInput.value.trim().slice(0, 16);
  if (nickname) {
    localStorage.setItem(nicknameStorageKey, nickname);
    return nickname;
  }
  return "玩家";
}

function getWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

function ensureSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return socket;
  }
  if (socket && socket.readyState === WebSocket.CONNECTING) {
    return socket;
  }

  socket = new WebSocket(getWebSocketUrl());
  setConnectionStatus("offline", "连接中");

  socket.addEventListener("open", () => {
    setConnectionStatus("online", "已连接");
  });

  socket.addEventListener("message", (event) => {
    handleServerMessage(event.data);
  });

  socket.addEventListener("close", () => {
    setConnectionStatus("offline", "已断开");
    if (mode === "online") {
      onlineState = createInitialOnlineState();
      stopMusic();
      updateHud();
      updatePlayersPanel();
      renderChat([]);
      draw();
      setStatus("连接已断开，请重新创建或加入房间。");
    }
  });

  socket.addEventListener("error", () => {
    setStatus("连接失败，请确认服务端已启动。");
  });

  return socket;
}

function sendMessage(message) {
  const currentSocket = ensureSocket();
  if (currentSocket.readyState === WebSocket.OPEN) {
    currentSocket.send(JSON.stringify(message));
    return;
  }
  currentSocket.addEventListener("open", () => {
    currentSocket.send(JSON.stringify(message));
  }, { once: true });
}

function enterOnlineMode() {
  mode = "online";
  clearInterval(soloState.gameLoop);
  soloState.gameLoop = null;
  soloState.isRunning = false;
  soloState.isPaused = false;
  stopMusic();
  musicStep = 0;
  updateHud();
}

function leaveOnlineRoom(notifyServer = true) {
  if (notifyServer && socket && socket.readyState === WebSocket.OPEN && onlineState.roomCode) {
    socket.send(JSON.stringify({ type: "leave_room" }));
  }

  onlineState = createInitialOnlineState();
  mode = "solo";
  setInviteUrl("");
  setConnectionStatus(
    socket && socket.readyState === WebSocket.OPEN ? "online" : "offline",
    socket && socket.readyState === WebSocket.OPEN ? "已连接" : "未连接"
  );
  roomCodeDisplay.textContent = "未加入";
  updatePlayersPanel();
  renderChat([]);
  resetSoloGame();
}

function createRoom() {
  enterOnlineMode();
  sendMessage({ type: "create_room", name: getNickname() });
}

function joinRoom() {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    setStatus("请输入房间码。");
    return;
  }
  enterOnlineMode();
  sendMessage({ type: "join_room", roomCode: code, name: getNickname() });
}

function requestRestart() {
  if (mode === "online") {
    if (!onlineState.roomCode) {
      setStatus("当前没有联机房间。");
      return;
    }
    sendMessage({ type: "restart_game" });
    setStatus("已请求重新开始。");
    return;
  }
  resetSoloGame();
}

function getMyPlayer() {
  return onlineState.players.find((player) => player.id === onlineState.myPlayerId) || null;
}

function isHost() {
  return onlineState.hostId && onlineState.hostId === onlineState.myPlayerId;
}

function canStartOnlineGame() {
  return onlineState.players.length === 2 && onlineState.players.every((player) => player.ready);
}

function getOnlineStatusText() {
  if (!onlineState.roomCode) {
    return "联机未开始。";
  }
  if (onlineState.status === "waiting") {
    if (onlineState.players.length < 2) {
      return `房间 ${onlineState.roomCode} 已创建，等待另一位玩家加入。`;
    }
    if (!canStartOnlineGame()) {
      return "两位玩家都点击准备后，房主才能开始对局。";
    }
    return isHost() ? "双方已准备，点击房主开始进入对局。" : "双方已准备，等待房主开始。";
  }
  if (onlineState.status === "running") {
    return "联机对局进行中，方向键输入会实时发送到服务端。";
  }
  if (onlineState.status === "finished") {
    if (!onlineState.winnerId) {
      return "本局平局，点击重新开始可再来一局。";
    }
    const winner = onlineState.players.find((player) => player.id === onlineState.winnerId);
    if (!winner) {
      return "本局已结束，点击重新开始可再来一局。";
    }
    return winner.id === onlineState.myPlayerId
      ? "你赢了，点击重新开始可再来一局。"
      : `${winner.name} 获胜，点击重新开始可再来一局。`;
  }
  return "联机房间已连接。";
}

function updatePlayersPanel() {
  if (mode === "online") {
    const [playerOne, playerTwo] = onlineState.players;
    playerOneNameEl.textContent = playerOne ? playerOne.name : "等待中";
    playerOneScoreEl.textContent = playerOne ? `${playerOne.score} 分 | ${playerOne.ready ? "已准备" : "未准备"}` : "0 分";
    playerTwoNameEl.textContent = playerTwo ? playerTwo.name : "等待中";
    playerTwoScoreEl.textContent = playerTwo ? `${playerTwo.score} 分 | ${playerTwo.ready ? "已准备" : "未准备"}` : "0 分";
    return;
  }
  playerOneNameEl.textContent = "本地玩家";
  playerOneScoreEl.textContent = `${soloState.score} 分`;
  playerTwoNameEl.textContent = "联机位";
  playerTwoScoreEl.textContent = "等待中";
}

function syncAudioWithOnlineState() {
  const myPlayer = getMyPlayer();
  const myScore = myPlayer ? myPlayer.score : 0;

  if (onlineState.status === "running" && lastAudioSnapshot.status !== "running") {
    ensureAudioContext();
    playStartSound();
    scheduleMusic();
  }

  if (myScore > lastAudioSnapshot.myScore) {
    playEatSound();
  }

  if (onlineState.status === "finished" && lastAudioSnapshot.status === "running") {
    playCrashSound();
    stopMusic();
  }

  if (onlineState.status !== "running") {
    stopMusic();
  }

  lastAudioSnapshot = {
    status: onlineState.status,
    myScore,
  };
}

function updateRoomStateBadge() {
  roomStateBadge.className = "room-state-badge";
  readyHintEl.className = "ready-hint";

  if (mode !== "online" || !onlineState.roomCode) {
    roomStateBadge.classList.add("idle");
    roomStateBadge.textContent = "空闲";
    readyHintEl.textContent = "等待玩家准备";
    return;
  }

  if (onlineState.status === "running") {
    roomStateBadge.classList.add("running");
    roomStateBadge.textContent = "对局中";
    readyHintEl.textContent = "对局进行中";
    return;
  }

  if (onlineState.status === "finished") {
    roomStateBadge.classList.add("finished");
    roomStateBadge.textContent = "已结束";
    readyHintEl.textContent = "本局已结束";
    return;
  }

  if (canStartOnlineGame()) {
    roomStateBadge.classList.add("ready");
    roomStateBadge.textContent = "可开始";
    readyHintEl.classList.add("ready-pulse");
    readyHintEl.textContent = isHost() ? "两人已准备，等待你开始" : "两人已准备，等待房主开始";
    return;
  }

  roomStateBadge.classList.add("waiting");
  roomStateBadge.textContent = "等待中";
  readyHintEl.textContent = "等待两位玩家都准备";
}

function renderChat(chat) {
  const safeChat = Array.isArray(chat) ? chat : [];
  const lastId = safeChat.length ? safeChat[safeChat.length - 1].id : "";
  const shouldStickBottom = chatLogEl.scrollTop + chatLogEl.clientHeight >= chatLogEl.scrollHeight - 12;

  if (lastRenderedChatId === lastId && chatLogEl.childElementCount === safeChat.length) {
    return;
  }

  chatLogEl.innerHTML = "";
  safeChat.forEach((entry) => {
    const item = document.createElement("div");
    item.className = `chat-item ${entry.type === "system" ? "system" : (entry.playerId === onlineState.myPlayerId ? "mine" : "other")}`;

    const author = document.createElement("strong");
    author.className = "chat-author";
    author.textContent = entry.author;

    const text = document.createElement("span");
    text.className = "chat-text";
    text.textContent = entry.text;

    item.append(author, text);
    chatLogEl.appendChild(item);
  });

  if (shouldStickBottom || lastRenderedChatId !== lastId) {
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  lastRenderedChatId = lastId;
}

function handleStateMessage(state) {
  const nextSnakes = (state.players || []).filter(Boolean).map((player, index) => ({
    id: player.id,
    direction: player.direction,
    snake: (player.snake || []).map(cloneSegment),
    theme: index === 0 ? snakeThemes.player1 : snakeThemes.player2,
  }));

  onlineState.roomCode = state.roomCode;
  onlineState.myPlayerId = state.yourPlayerId || onlineState.myPlayerId;
  onlineState.hostId = state.hostId || null;
  onlineState.players = (state.players || []).filter(Boolean).map((player) => ({
    id: player.id,
    name: player.name,
    score: player.score,
    ready: Boolean(player.ready),
    alive: player.alive,
  }));
  onlineState.previousSnakes = onlineState.snakes.map((snake) => ({
    ...snake,
    snake: snake.snake.map(cloneSegment),
  }));
  onlineState.snakes = nextSnakes;
  onlineState.fruits = Array.isArray(state.fruits) ? state.fruits : [];
  onlineState.bombs = Array.isArray(state.bombs) ? state.bombs : [];
  onlineState.status = state.matchState || "waiting";
  onlineState.winnerId = state.winnerId || null;
  onlineState.chat = state.chat || [];
  onlineState.stateUpdatedAt = performance.now();

  roomCodeDisplay.textContent = onlineState.roomCode || "未加入";
  roomCodeInput.value = onlineState.roomCode || roomCodeInput.value;
  setInviteUrl(onlineState.roomCode || "");
  mode = onlineState.roomCode ? "online" : "solo";

  maybeUpdateHighScore(getMyOnlineScore());
  syncAudioWithOnlineState();
  updatePlayersPanel();
  renderChat(onlineState.chat);
  updateHud();
}

function handleServerMessage(rawMessage) {
  const message = JSON.parse(rawMessage);

  if (message.type === "room_state") {
    handleStateMessage(message.payload);
    return;
  }

  if (message.type === "error") {
    setStatus(message.message || "服务端返回错误。");
    if (!onlineState.roomCode) {
      mode = "solo";
      updateHud();
    }
  }
}

function getMyOnlineScore() {
  const myPlayer = getMyPlayer();
  return myPlayer ? myPlayer.score : 0;
}

async function copyInviteLink() {
  if (!onlineState.roomCode) {
    setStatus("当前没有可复制的房间链接。");
    return;
  }

  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", onlineState.roomCode);

  try {
    await navigator.clipboard.writeText(inviteUrl.toString());
    setStatus("邀请链接已复制，直接发给朋友即可。");
  } catch {
    roomCodeInput.select();
    setStatus("浏览器未授权剪贴板，已选中房间码，请手动复制。");
  }
}

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !onlineState.roomCode) {
    return;
  }

  sendMessage({ type: "chat_message", text });
  chatInput.value = "";
}

function updateHud() {
  if (mode === "online") {
    scoreEl.textContent = String(getMyOnlineScore());
    highScoreEl.textContent = String(highScore);
    speedEl.textContent = `${(baseDelay / onlineTickDelay).toFixed(1)}x`;
    pauseButton.disabled = true;
    pauseButton.textContent = "暂停";
    copyRoomButton.disabled = !onlineState.roomCode;
    leaveRoomButton.disabled = !onlineState.roomCode;
    chatInput.disabled = !onlineState.roomCode;
    chatSendButton.disabled = !onlineState.roomCode;
    modeLabel.textContent = "联机";
    startButton.disabled = !onlineState.roomCode || !isHost() || onlineState.status === "running" || !canStartOnlineGame();
    startButton.textContent = onlineState.roomCode ? "房主开始" : "单机开始";

    const myPlayer = getMyPlayer();
    restartButton.textContent = onlineState.status === "waiting" ? (myPlayer && myPlayer.ready ? "取消准备" : "准备") : "重新开始";
    updateRoomStateBadge();
    setStatus(getOnlineStatusText());
    return;
  }

  scoreEl.textContent = String(soloState.score);
  highScoreEl.textContent = String(highScore);
  speedEl.textContent = `${(baseDelay / soloState.tickDelay).toFixed(1)}x`;
  pauseButton.disabled = !soloState.isRunning;
  pauseButton.textContent = soloState.isPaused ? "继续" : "暂停";
  copyRoomButton.disabled = true;
  leaveRoomButton.disabled = true;
  chatInput.disabled = true;
  chatSendButton.disabled = true;
  startButton.disabled = false;
  startButton.textContent = "单机开始";
  restartButton.textContent = "重新开始";
  modeLabel.textContent = "单机";
  updateRoomStateBadge();
  updatePlayersPanel();
}

function getOnlineDirection() {
  const mySnake = onlineState.snakes.find((snake) => snake.id === onlineState.myPlayerId);
  return mySnake ? mySnake.direction : null;
}

function sendDirection(next) {
  if (mode === "online") {
    if (onlineState.status !== "running") {
      return;
    }

    const currentDirection = getOnlineDirection();
    const reversing = currentDirection && next.x + currentDirection.x === 0 && next.y + currentDirection.y === 0;
    if (reversing) {
      return;
    }

    sendMessage({ type: "change_direction", direction: next.name });
    return;
  }

  setSoloDirection(next);
}

function handleRestartOrReady() {
  if (mode === "online" && onlineState.roomCode) {
    if (onlineState.status === "waiting") {
      sendMessage({ type: "toggle_ready" });
      return;
    }

    requestRestart();
    return;
  }

  requestRestart();
}

document.addEventListener("keydown", (event) => {
  if (event.target === chatInput && event.key === "Enter") {
    event.preventDefault();
    sendChatMessage();
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    if (mode === "solo") {
      togglePause();
    }
    return;
  }

  const next = directionMap[event.key];
  if (!next) {
    return;
  }

  event.preventDefault();
  sendDirection(next);
});

startButton.addEventListener("click", startSoloGame);
pauseButton.addEventListener("click", togglePause);
restartButton.addEventListener("click", handleRestartOrReady);
audioButton.addEventListener("click", () => {
  audioEnabled = !audioEnabled;
  updateAudioButton();

  if (!audioEnabled) {
    stopMusic();
    return;
  }

  ensureAudioContext();
  scheduleMusic();
  playStartSound();
});

createRoomButton.addEventListener("click", createRoom);
joinRoomButton.addEventListener("click", joinRoom);
copyRoomButton.addEventListener("click", copyInviteLink);
leaveRoomButton.addEventListener("click", () => leaveOnlineRoom(true));
chatSendButton.addEventListener("click", sendChatMessage);

touchButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const next = Object.values(directionMap).find((item) => item.name === button.dataset.direction);
    sendDirection(next);
  });
});

updateAudioButton();
highScoreEl.textContent = String(highScore);
renderChat([]);
resetSoloGame();
startRenderLoop();
