import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set, get, update, onValue, onDisconnect, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// State Variables
let currentUser = null;
let currentRoomId = null;
let isHost = false;
let roomUnsubscribe = null;

// DOM Elements
const playerNameInput = document.getElementById("player-name");
const roomCodeInput = document.getElementById("room-code-input");
const displayRoomCode = document.getElementById("display-room-code");
const lobbyPlayerList = document.getElementById("lobby-player-list");
const playerCount = document.getElementById("player-count");
const lobbyStatusMsg = document.getElementById("lobby-status-msg");

const menuSection = document.getElementById("menu-section");
const createSection = document.getElementById("create-section");
const joinSection = document.getElementById("join-section");
const lobbySection = document.getElementById("lobby-section");

const btnShowCreate = document.getElementById("btn-show-create");
const btnShowJoin = document.getElementById("btn-show-join");
const btnConfirmCreate = document.getElementById("btn-confirm-create");
const btnConfirmJoin = document.getElementById("btn-confirm-join");
const btnStartGame = document.getElementById("btn-start-game");
const btnLeaveLobby = document.getElementById("btn-leave-lobby");
const btnCopyCode = document.getElementById("btn-copy-code");
const btnRules = document.getElementById("btn-rules");
const btnCloseRules = document.getElementById("btn-close-rules");
const btnUnderstood = document.getElementById("btn-understood");
const rulesModal = document.getElementById("rules-modal");
const toast = document.getElementById("toast");

// Toast Notification Helper
function showToast(msg) {
    console.warn("[Game Toast]:", msg);
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove("hidden");
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 4500);
}

// Timeout helper to prevent infinite network hangs
function withTimeout(promise, timeoutMs = 7000, errorMsg = "Operation timed out. Check Realtime Database URL & Rules in Firebase Console.") {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), timeoutMs))
    ]);
}

// Authenticate Anonymously on startup
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const savedName = localStorage.getItem("uno_player_name");
        if (savedName && playerNameInput) {
            playerNameInput.value = savedName;
        }
    } else {
        signInAnonymously(auth).catch((err) => {
            showToast("Auth Error: " + err.message);
        });
    }
});

// Helper: Ensure user is logged in before database actions
async function ensureAuth() {
    if (currentUser) return currentUser;
    try {
        const cred = await withTimeout(
            signInAnonymously(auth),
            5000,
            "Authentication timed out. Make sure Anonymous Auth is enabled in Firebase."
        );
        currentUser = cred.user;
        return currentUser;
    } catch (err) {
        showToast(err.message);
        return null;
    }
}

// Generate a 6-character room code (without easily confused letters/numbers)
function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Validate Player Name
function validateName() {
    const name = playerNameInput.value.trim();
    if (!name) {
        showToast("Please enter your nickname first!");
        showSection(menuSection);
        playerNameInput.focus();
        return null;
    }
    if (name.length > 15) {
        showToast("Nickname must be 15 characters or less.");
        return null;
    }
    localStorage.setItem("uno_player_name", name);
    return name;
}

// UI Navigation: Switch between boxes
function showSection(section) {
    [menuSection, createSection, joinSection, lobbySection].forEach((s) => {
        if (s) s.classList.add("hidden");
    });
    if (section) section.classList.remove("hidden");
}

document.querySelectorAll(".btn-back").forEach((btn) => {
    btn.addEventListener("click", () => showSection(menuSection));
});

btnShowCreate.addEventListener("click", () => {
    if (validateName()) showSection(createSection);
});

btnShowJoin.addEventListener("click", () => {
    if (validateName()) showSection(joinSection);
});

// ----------------------------------------------------
// CREATE ROOM HANDLER (With Timeout Protection)
// ----------------------------------------------------
btnConfirmCreate.addEventListener("click", async () => {
    const name = validateName();
    if (!name) return;

    btnConfirmCreate.disabled = true;
    btnConfirmCreate.textContent = "CREATING...";

    const user = await ensureAuth();
    if (!user) {
        btnConfirmCreate.disabled = false;
        btnConfirmCreate.textContent = "LAUNCH LOBBY";
        return;
    }

    const roomId = generateRoomCode();
    currentRoomId = roomId;
    isHost = true;

    const roomRef = ref(db, `rooms/${roomId}`);
    const initialData = {
        roomId: roomId,
        hostId: user.uid,
        status: "lobby",
        createdAt: Date.now(),
        players: {
            [user.uid]: {
                id: user.uid,
                name: name,
                isHost: true,
                cardCount: 0,
                unoCalled: false,
                connected: true
            }
        }
    };

    try {
        await withTimeout(
            set(roomRef, initialData),
            7000,
            "Database connection timed out! Make sure Realtime Database is created in Firebase Console and rules are set to public."
        );

        // Disconnect handler
        const playerRef = ref(db, `rooms/${roomId}/players/${user.uid}`);
        onDisconnect(playerRef).update({ connected: false });

        enterLobby(roomId);
    } catch (err) {
        console.error(err);
        showToast(err.message);
    } finally {
        btnConfirmCreate.disabled = false;
        btnConfirmCreate.textContent = "LAUNCH LOBBY";
    }
});

// ----------------------------------------------------
// JOIN ROOM HANDLER (With Timeout Protection)
// ----------------------------------------------------
btnConfirmJoin.addEventListener("click", async () => {
    const name = validateName();
    const code = roomCodeInput.value.trim().toUpperCase();

    if (!name) return;
    if (code.length !== 6) {
        showToast("Room code must be 6 characters long.");
        return;
    }

    btnConfirmJoin.disabled = true;
    btnConfirmJoin.textContent = "JOINING...";

    const user = await ensureAuth();
    if (!user) {
        btnConfirmJoin.disabled = false;
        btnConfirmJoin.textContent = "JOIN GAME";
        return;
    }

    const roomRef = ref(db, `rooms/${code}`);
    try {
        const snapshot = await withTimeout(
            get(roomRef),
            7000,
            "Connection timed out. Check your Internet connection and Firebase configuration."
        );

        if (!snapshot.exists()) {
            showToast("Room does not exist. Check code.");
            return;
        }

        const roomData = snapshot.val();
        if (roomData.status !== "lobby") {
            showToast("Game in this room has already started or ended.");
            return;
        }

        const players = roomData.players || {};
        const playerKeys = Object.keys(players);

        if (playerKeys.length >= 4 && !players[user.uid]) {
            showToast("Room is full (Max 4 players).");
            return;
        }

        currentRoomId = code;
        isHost = roomData.hostId === user.uid;

        await withTimeout(
            update(ref(db, `rooms/${code}/players/${user.uid}`), {
                id: user.uid,
                name: name,
                isHost: isHost,
                cardCount: 0,
                unoCalled: false,
                connected: true
            })
        );

        const playerRef = ref(db, `rooms/${code}/players/${user.uid}`);
        onDisconnect(playerRef).update({ connected: false });

        enterLobby(code);
    } catch (err) {
        console.error(err);
        showToast(err.message);
    } finally {
        btnConfirmJoin.disabled = false;
        btnConfirmJoin.textContent = "JOIN GAME";
    }
});

// ----------------------------------------------------
// LOBBY REAL-TIME LISTENER
// ----------------------------------------------------
function enterLobby(roomId) {
    showSection(lobbySection);
    displayRoomCode.textContent = roomId;

    const roomRef = ref(db, `rooms/${roomId}`);

    if (roomUnsubscribe) roomUnsubscribe();

    roomUnsubscribe = onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            showToast("Room has been closed or removed.");
            leaveLobby(false);
            return;
        }

        const roomData = snapshot.val();

        // Redirect to game arena if host started the game
        if (roomData.status === "playing") {
            sessionStorage.setItem("uno_room_id", roomId);
            sessionStorage.setItem("uno_player_id", currentUser.uid);
            window.location.href = `game.html?room=${roomId}`;
            return;
        }

        const players = roomData.players || {};
        const activePlayers = Object.values(players).filter((p) => p.connected !== false);

        // Host migration if original host left
        if (!players[roomData.hostId] || players[roomData.hostId].connected === false) {
            if (activePlayers.length > 0) {
                const newHost = activePlayers[0];
                update(roomRef, { hostId: newHost.id });
                update(ref(db, `rooms/${roomId}/players/${newHost.id}`), { isHost: true });
            }
        }

        isHost = roomData.hostId === currentUser.uid;
        playerCount.textContent = activePlayers.length;

        // Render player roster
        lobbyPlayerList.innerHTML = "";
        activePlayers.forEach((p, idx) => {
            const li = document.createElement("li");
            li.className = `roster-item ${p.id === currentUser.uid ? "is-you" : ""}`;
            li.innerHTML = `
                <span>${idx + 1}. ${p.name} ${p.id === currentUser.uid ? "(You)" : ""}</span>
                ${p.isHost ? '<span class="host-badge">HOST</span>' : ""}
            `;
            lobbyPlayerList.appendChild(li);
        });

        // Host actions & buttons
        if (isHost) {
            btnStartGame.classList.remove("hidden");
            if (activePlayers.length >= 2) {
                btnStartGame.disabled = false;
                lobbyStatusMsg.textContent = "Ready to begin! Click Start Game.";
            } else {
                btnStartGame.disabled = true;
                lobbyStatusMsg.textContent = "Waiting for at least 2 players to join...";
            }
        } else {
            btnStartGame.classList.add("hidden");
            lobbyStatusMsg.textContent = "Waiting for host to start the game...";
        }
    });
}

// ----------------------------------------------------
// START GAME ACTION (HOST ONLY)
// ----------------------------------------------------
btnStartGame.addEventListener("click", async () => {
    if (!isHost || !currentRoomId) return;

    btnStartGame.disabled = true;
    btnStartGame.textContent = "DEALING...";

    try {
        const snapshot = await get(ref(db, `rooms/${currentRoomId}/players`));
        const players = snapshot.val() || {};
        const playerIds = Object.keys(players).filter((id) => players[id].connected !== false);

        if (playerIds.length < 2) {
            showToast("Need at least 2 connected players to start!");
            btnStartGame.disabled = false;
            btnStartGame.textContent = "START GAME";
            return;
        }

        const { deck, hands, topCard } = initializeGameCards(playerIds);

        const playerUpdates = {};
        playerIds.forEach((id) => {
            playerUpdates[`rooms/${currentRoomId}/players/${id}/cardCount`] = 7;
            playerUpdates[`rooms/${currentRoomId}/players/${id}/unoCalled`] = false;
            playerUpdates[`rooms/${currentRoomId}/hands/${id}`] = hands[id];
        });

        await withTimeout(
            update(ref(db), {
                ...playerUpdates,
                [`rooms/${currentRoomId}/status`]: "playing",
                [`rooms/${currentRoomId}/game`]: {
                    deck: deck,
                    discardPile: [topCard],
                    currentColor: topCard.color === "wild" ? "red" : topCard.color,
                    turnIndex: 0,
                    direction: 1,
                    turnPlayerId: playerIds[0],
                    playerOrder: playerIds,
                    lastAction: "Game has started!",
                    cardsDrawnThisTurn: 0,
                    totalTurns: 0,
                    totalCardsPlayed: 1
                }
            }),
            8000,
            "Failed to start game due to connection timeout."
        );
    } catch (err) {
        showToast("Error starting game: " + err.message);
        btnStartGame.disabled = false;
        btnStartGame.textContent = "START GAME";
    }
});

// Card Creation & Fisher-Yates Shuffle
function initializeGameCards(playerIds) {
    const colors = ["red", "blue", "green", "yellow"];
    const numbers = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const actions = ["skip", "reverse", "draw2"];
    let deck = [];

    // Colored cards
    colors.forEach((color) => {
        deck.push({ id: `${color}-0-${Math.random()}`, color, value: "0", type: "number" });
        for (let i = 0; i < 2; i++) {
            numbers.slice(1).forEach((num) => {
                deck.push({ id: `${color}-${num}-${i}-${Math.random()}`, color, value: num, type: "number" });
            });
            actions.forEach((action) => {
                deck.push({ id: `${color}-${action}-${i}-${Math.random()}`, color, value: action, type: "action" });
            });
        }
    });

    // 4 Wild and 4 Wild Draw 4 cards
    for (let i = 0; i < 4; i++) {
        deck.push({ id: `wild-${i}-${Math.random()}`, color: "wild", value: "wild", type: "wild" });
        deck.push({ id: `wild4-${i}-${Math.random()}`, color: "wild", value: "wild4", type: "wild" });
    }

    // Fisher-Yates Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // Deal 7 cards each
    const hands = {};
    playerIds.forEach((id) => {
        hands[id] = deck.splice(0, 7);
    });

    // Pick top discard card
    let topCardIndex = deck.findIndex((c) => c.value !== "wild4");
    if (topCardIndex === -1) topCardIndex = 0;
    const topCard = deck.splice(topCardIndex, 1)[0];

    return { deck, hands, topCard };
}

// Copy Code Button
btnCopyCode.addEventListener("click", () => {
    if (currentRoomId) {
        navigator.clipboard.writeText(currentRoomId).then(() => {
            showToast("Room code copied to clipboard!");
        });
    }
});

// Leave Lobby Handler
async function leaveLobby(shouldClean = true) {
    if (shouldClean && currentRoomId && currentUser) {
        try {
            await remove(ref(db, `rooms/${currentRoomId}/players/${currentUser.uid}`));
        } catch (e) {
            console.error(e);
        }
    }
    if (roomUnsubscribe) roomUnsubscribe();
    currentRoomId = null;
    isHost = false;
    showSection(menuSection);
}
btnLeaveLobby.addEventListener("click", () => leaveLobby(true));

// Rules Modal Handlers
btnRules.addEventListener("click", () => rulesModal.classList.remove("hidden"));
btnCloseRules.addEventListener("click", () => rulesModal.classList.add("hidden"));
btnUnderstood.addEventListener("click", () => rulesModal.classList.add("hidden"));
