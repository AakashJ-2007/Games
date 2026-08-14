import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, update, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// State Variables
let currentUser = null;
let roomId = null;
let gameState = null;
let myHand = [];
let playersMap = {};
let isMyTurn = false;
let pendingWildCard = null;
let soundEnabled = true;

// Sound Synthesizer via Web Audio API (Guaranteed to work without external asset failures)
class SoundSystem {
    constructor() {
        this.ctx = null;
    }
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    playCard() {
        if (!soundEnabled) return;
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(440, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.12);
    }
    playUno() {
        if (!soundEnabled) return;
        this.init();
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.08);
            gain.gain.setValueAtTime(0.25, this.ctx.currentTime + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + idx * 0.08 + 0.15);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(this.ctx.currentTime + idx * 0.08);
            osc.stop(this.ctx.currentTime + idx * 0.08 + 0.15);
        });
    }
    playWin() {
        if (!soundEnabled) return;
        this.init();
        const notes = [440, 554, 659, 880];
        notes.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime + (i * 0.15));
            gain.gain.setValueAtTime(0.3, this.ctx.currentTime + (i * 0.15));
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + (i * 0.15) + 0.4);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(this.ctx.currentTime + (i * 0.15));
            osc.stop(this.ctx.currentTime + (i * 0.15) + 0.4);
        });
    }
}
const sounds = new SoundSystem();

// DOM Elements
const gameRoomIdEl = document.getElementById("game-room-id");
const directionIndicator = document.getElementById("direction-indicator");
const opponentsContainer = document.getElementById("opponents-container");
const discardPileEl = document.getElementById("discard-pile");
const drawPileEl = document.getElementById("draw-pile");
const activeColorNameEl = document.getElementById("active-color-name");
const currentColorBadge = document.getElementById("current-color-badge");
const gameAnnouncer = document.getElementById("game-announcer");
const currentPlayerNameEl = document.getElementById("current-player-name");
const yourCardCountEl = document.getElementById("your-card-count");
const playerHandEl = document.getElementById("player-hand");
const btnCallUno = document.getElementById("btn-call-uno");
const btnCatchUno = document.getElementById("btn-catch-uno");
const btnPassTurn = document.getElementById("btn-pass-turn");
const btnLeaveGame = document.getElementById("btn-leave-game");
const btnSoundToggle = document.getElementById("btn-sound-toggle");
const colorPickerModal = document.getElementById("color-picker-modal");
const winModal = document.getElementById("win-modal");
const winnerTitle = document.getElementById("winner-title");
const winnerSubtitle = document.getElementById("winner-subtitle");
const statTurns = document.getElementById("stat-turns");
const statCardsPlayed = document.getElementById("stat-cards-played");
const btnPlayAgain = document.getElementById("btn-play-again");
const btnExitToLobby = document.getElementById("btn-exit-to-lobby");
const gameToast = document.getElementById("game-toast");

function showToast(msg) {
    gameToast.textContent = msg;
    gameToast.classList.remove("hidden");
    setTimeout(() => gameToast.classList.add("hidden"), 3000);
}

// Get Query Params
const urlParams = new URLSearchParams(window.location.search);
roomId = urlParams.get("room") || sessionStorage.getItem("uno_room_id");

if (!roomId) {
    alert("No room specified! Redirecting to lobby.");
    window.location.href = "index.html";
} else {
    gameRoomIdEl.textContent = roomId;
}

// Authentication Check
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        initGameListeners();
    } else {
        window.location.href = "index.html";
    }
});

// Setup Listeners
function initGameListeners() {
    const roomRef = ref(db, `rooms/${roomId}`);

    // Disconnect handler
    const myPlayerRef = ref(db, `rooms/${roomId}/players/${currentUser.uid}`);
    onDisconnect(myPlayerRef).update({ connected: false });

    // Listen to full room state
    onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            alert("This match has ended.");
            window.location.href = "index.html";
            return;
        }

        const data = snapshot.val();
        playersMap = data.players || {};
        gameState = data.game;

        if (data.status === "finished") {
            handleGameOver(data.winnerId);
            return;
        }

        if (!gameState) return;

        // Listen to private hand
        if (data.hands && data.hands[currentUser.uid]) {
            myHand = data.hands[currentUser.uid];
        } else {
            myHand = [];
        }

        renderArena();
    });
}

// Render complete game table
function renderArena() {
    if (!gameState || !playersMap[currentUser.uid]) return;

    isMyTurn = (gameState.turnPlayerId === currentUser.uid);

    // Update Player & Top bar info
    currentPlayerNameEl.textContent = playersMap[currentUser.uid].name;
    yourCardCountEl.textContent = myHand.length;
    directionIndicator.textContent = gameState.direction === 1 ? "↻ CLOCKWISE" : "↺ COUNTER-CLOCKWISE";

    // Active color indicator
    const topDiscard = gameState.discardPile[gameState.discardPile.length - 1];
    const activeColor = gameState.currentColor || topDiscard.color;
    activeColorNameEl.textContent = activeColor.toUpperCase();
    currentColorBadge.style.color = getColorHex(activeColor);

    // Announcer banner
    const turnPlayer = playersMap[gameState.turnPlayerId];
    if (isMyTurn) {
        gameAnnouncer.textContent = "👉 YOUR TURN! Choose a card or draw.";
        gameAnnouncer.style.color = "var(--uno-yellow)";
    } else {
        gameAnnouncer.textContent = `Waiting for ${turnPlayer ? turnPlayer.name : "opponent"}...`;
        gameAnnouncer.style.color = "#FFF";
    }

    // Pass turn button visibility (if drawn card this turn)
    if (isMyTurn && gameState.cardsDrawnThisTurn > 0) {
        btnPassTurn.classList.remove("hidden");
    } else {
        btnPassTurn.classList.add("hidden");
    }

    // UNO Button enablement
    btnCallUno.disabled = (myHand.length !== 1 || playersMap[currentUser.uid].unoCalled);

    renderOpponents();
    renderDiscardPile(topDiscard);
    renderMyHand(topDiscard, activeColor);
}

// Render Opponents
function renderOpponents() {
    opponentsContainer.innerHTML = "";
    const activePlayerIds = gameState.playerOrder || [];

    activePlayerIds.forEach(pId => {
        if (pId === currentUser.uid) return;
        const player = playersMap[pId];
        if (!player) return;

        const isOpponentTurn = (gameState.turnPlayerId === pId);
        const cardCount = player.cardCount || 0;

        const oppDiv = document.createElement("div");
        oppDiv.className = `opponent-card ${isOpponentTurn ? "active-turn" : ""}`;
        oppDiv.innerHTML = `
            <span class="opp-name">${player.name}</span>
            <div class="opp-cards-visual">
                <div class="mini-card-icon"></div>
                <span class="opp-card-count">${cardCount}</span>
            </div>
            ${player.unoCalled && cardCount === 1 ? '<span class="opp-uno-badge">UNO!</span>' : ''}
            ${!player.connected ? '<span style="font-size:0.65rem; color:#ff6666;">(Offline)</span>' : ''}
        `;
        opponentsContainer.appendChild(oppDiv);
    });
}

// Render Top Discard Card
function renderDiscardPile(card) {
    discardPileEl.innerHTML = "";
    discardPileEl.appendChild(createCardElement(card, false));
}

// Render Player Hand
function renderMyHand(topDiscard, activeColor) {
    playerHandEl.innerHTML = "";

    myHand.forEach((card, index) => {
        const playable = isMyTurn && checkCardPlayable(card, topDiscard, activeColor);
        const cardEl = createCardElement(card, playable);

        if (playable) {
            cardEl.addEventListener("click", () => handleCardClick(card, index));
        } else if (isMyTurn) {
            cardEl.classList.add("disabled");
        }

        playerHandEl.appendChild(cardEl);
    });
}

// Helper to create Card HTML
function createCardElement(card, isPlayable) {
    const cardEl = document.createElement("div");
    cardEl.className = `card c-${card.color} ${!isPlayable && isMyTurn ? "disabled" : ""}`;

    let symbol = card.value;
    if (card.value === "skip") symbol = "⊘";
    if (card.value === "reverse") symbol = "⇄";
    if (card.value === "draw2") symbol = "+2";
    if (card.value === "wild") symbol = "★";
    if (card.value === "wild4") symbol = "+4";

    cardEl.innerHTML = `
        <div class="card-inner">
            <span class="card-corner corner-top-left">${symbol}</span>
            <div class="card-oval">
                <span class="card-val">${symbol}</span>
            </div>
            <span class="card-corner corner-bottom-right">${symbol}</span>
        </div>
    `;
    return cardEl;
}

// Play Rule Validation
function checkCardPlayable(card, topDiscard, activeColor) {
    if (card.color === "wild") {
        if (card.value === "wild4") {
            // Official rule: Wild Draw 4 can only be played if no card matches current active color
            const hasMatchingColor = myHand.some(c => c.color === activeColor);
            return !hasMatchingColor;
        }
        return true;
    }
    if (card.color === activeColor) return true;
    if (card.value === topDiscard.value) return true;
    return false;
}

// Card Click Action
function handleCardClick(card, cardIndex) {
    if (!isMyTurn) return;

    if (card.color === "wild") {
        pendingWildCard = { card, cardIndex };
        colorPickerModal.classList.remove("hidden");
        return;
    }

    executePlayCard(card, cardIndex, card.color);
}

// Execute Play Card & State Mutation
async function executePlayCard(card, cardIndex, chosenColor) {
    sounds.playCard();

    const newHand = [...myHand];
    newHand.splice(cardIndex, 1);

    const isUno = (newHand.length === 1);
    const hasWon = (newHand.length === 0);

    const newDiscardPile = [...gameState.discardPile, card];
    let nextDirection = gameState.direction;
    let nextIndex = gameState.turnIndex;
    const playerOrder = gameState.playerOrder;
    const numPlayers = playerOrder.length;

    let actionMsg = `${playersMap[currentUser.uid].name} played ${card.color.toUpperCase()} ${card.value.toUpperCase()}`;

    // Apply Card Actions
    let cardsToGive = 0;
    let skipNext = false;

    if (card.value === "reverse") {
        if (numPlayers === 2) {
            skipNext = true; // Reverse behaves like Skip with 2 players
        } else {
            nextDirection *= -1;
        }
    } else if (card.value === "skip") {
        skipNext = true;
    } else if (card.value === "draw2") {
        cardsToGive = 2;
        skipNext = true;
    } else if (card.value === "wild4") {
        cardsToGive = 4;
        skipNext = true;
    }

    // Calculate Next Turn Index
    let step = nextDirection;
    if (skipNext) step *= 2;

    nextIndex = (nextIndex + step) % numPlayers;
    if (nextIndex < 0) nextIndex += numPlayers;

    const nextPlayerId = playerOrder[nextIndex];

    // Penalty card handling for Draw 2 / Wild Draw 4
    let updatedDeck = [...(gameState.deck || [])];
    const victimUpdates = {};

    if (cardsToGive > 0) {
        const victimCards = [];
        for (let i = 0; i < cardsToGive; i++) {
            if (updatedDeck.length === 0) {
                updatedDeck = reshuffleDiscardPile(newDiscardPile);
            }
            if (updatedDeck.length > 0) {
                victimCards.push(updatedDeck.shift());
            }
        }

        // Fetch victim hand and append
        const victimHandSnap = await get(ref(db, `rooms/${roomId}/hands/${nextPlayerId}`));
        const currentVictimHand = victimHandSnap.val() || [];
        const finalVictimHand = [...currentVictimHand, ...victimCards];

        victimUpdates[`rooms/${roomId}/hands/${nextPlayerId}`] = finalVictimHand;
        victimUpdates[`rooms/${roomId}/players/${nextPlayerId}/cardCount`] = finalVictimHand.length;
        victimUpdates[`rooms/${roomId}/players/${nextPlayerId}/unoCalled`] = false;
    }

    const updates = {
        ...victimUpdates,
        [`rooms/${roomId}/hands/${currentUser.uid}`]: newHand,
        [`rooms/${roomId}/players/${currentUser.uid}/cardCount`]: newHand.length,
        [`rooms/${roomId}/players/${currentUser.uid}/unoCalled`]: isUno ? playersMap[currentUser.uid].unoCalled : false,
        [`rooms/${roomId}/game/deck`]: updatedDeck,
        [`rooms/${roomId}/game/discardPile`]: newDiscardPile,
        [`rooms/${roomId}/game/currentColor`]: chosenColor,
        [`rooms/${roomId}/game/direction`]: nextDirection,
        [`rooms/${roomId}/game/turnIndex`]: nextIndex,
        [`rooms/${roomId}/game/turnPlayerId`]: nextPlayerId,
        [`rooms/${roomId}/game/lastAction`]: actionMsg,
        [`rooms/${roomId}/game/cardsDrawnThisTurn`]: 0,
        [`rooms/${roomId}/game/totalCardsPlayed`]: (gameState.totalCardsPlayed || 0) + 1,
        [`rooms/${roomId}/game/totalTurns`]: (gameState.totalTurns || 0) + 1
    };

    if (hasWon) {
        updates[`rooms/${roomId}/status`] = "finished";
        updates[`rooms/${roomId}/winnerId`] = currentUser.uid;
    }

    try {
        await update(ref(db), updates);
    } catch (e) {
        showToast("Action failed: " + e.message);
    }
}

// Draw Pile Click Action
drawPileEl.addEventListener("click", async () => {
    if (!isMyTurn) {
        showToast("It's not your turn!");
        return;
    }
    if (gameState.cardsDrawnThisTurn > 0) {
        showToast("You already drew a card this turn! Play it or pass.");
        return;
    }

    let currentDeck = [...(gameState.deck || [])];
    if (currentDeck.length === 0) {
        currentDeck = reshuffleDiscardPile(gameState.discardPile);
    }

    if (currentDeck.length === 0) {
        showToast("No cards left in the draw deck!");
        return;
    }

    sounds.playCard();
    const drawnCard = currentDeck.shift();
    const newHand = [...myHand, drawnCard];

    const updates = {
        [`rooms/${roomId}/hands/${currentUser.uid}`]: newHand,
        [`rooms/${roomId}/players/${currentUser.uid}/cardCount`]: newHand.length,
        [`rooms/${roomId}/players/${currentUser.uid}/unoCalled`]: false,
        [`rooms/${roomId}/game/deck`]: currentDeck,
        [`rooms/${roomId}/game/cardsDrawnThisTurn`]: 1,
        [`rooms/${roomId}/game/lastAction`]: `${playersMap[currentUser.uid].name} drew a card.`
    };

    await update(ref(db), updates);
});

// Pass Turn Action
btnPassTurn.addEventListener("click", async () => {
    if (!isMyTurn || gameState.cardsDrawnThisTurn === 0) return;

    const numPlayers = gameState.playerOrder.length;
    let nextIndex = (gameState.turnIndex + gameState.direction) % numPlayers;
    if (nextIndex < 0) nextIndex += numPlayers;

    const nextPlayerId = gameState.playerOrder[nextIndex];

    await update(ref(db), {
        [`rooms/${roomId}/game/turnIndex`]: nextIndex,
        [`rooms/${roomId}/game/turnPlayerId`]: nextPlayerId,
        [`rooms/${roomId}/game/cardsDrawnThisTurn`]: 0,
        [`rooms/${roomId}/game/lastAction`]: `${playersMap[currentUser.uid].name} passed turn.`
    });
});

// Reshuffle Discard Pile to Replenish Deck
function reshuffleDiscardPile(discardPile) {
    if (discardPile.length <= 1) return [];
    const topCard = discardPile[discardPile.length - 1];
    const newDeck = discardPile.slice(0, discardPile.length - 1);

    // Reset Wild colors to "wild"
    newDeck.forEach(c => {
        if (c.value === "wild" || c.value === "wild4") c.color = "wild";
    });

    for (let i = newDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }

    return newDeck;
}

// Color Picker Selection for Wild Cards
document.querySelectorAll(".color-choice-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const chosenColor = btn.getAttribute("data-color");
        colorPickerModal.classList.add("hidden");

        if (pendingWildCard) {
            const { card, cardIndex } = pendingWildCard;
            pendingWildCard = null;
            executePlayCard(card, cardIndex, chosenColor);
        }
    });
});

// UNO Call Button
btnCallUno.addEventListener("click", async () => {
    if (myHand.length === 1) {
        sounds.playUno();
        await update(ref(db, `rooms/${roomId}/players/${currentUser.uid}`), {
            unoCalled: true
        });
        showToast("You called UNO!");
    }
});

// Catch UNO Penalty Button
btnCatchUno.addEventListener("click", async () => {
    // Find players with 1 card who forgot to call UNO
    const offenders = Object.values(playersMap).filter(p => p.cardCount === 1 && !p.unoCalled && p.id !== currentUser.uid);

    if (offenders.length === 0) {
        showToast("No players forgot to call UNO.");
        return;
    }

    const victim = offenders[0];
    showToast(`Caught ${victim.name}! They draw 2 penalty cards.`);

    let currentDeck = [...(gameState.deck || [])];
    const penaltyCards = [];

    for (let i = 0; i < 2; i++) {
        if (currentDeck.length === 0) currentDeck = reshuffleDiscardPile(gameState.discardPile);
        if (currentDeck.length > 0) penaltyCards.push(currentDeck.shift());
    }

    const victimHandSnap = await get(ref(db, `rooms/${roomId}/hands/${victim.id}`));
    const finalHand = [...(victimHandSnap.val() || []), ...penaltyCards];

    await update(ref(db), {
        [`rooms/${roomId}/hands/${victim.id}`]: finalHand,
        [`rooms/${roomId}/players/${victim.id}/cardCount`]: finalHand.length,
        [`rooms/${roomId}/game/deck`]: currentDeck,
        [`rooms/${roomId}/game/lastAction`]: `${victim.name} was caught without calling UNO (+2 cards)!`
    });
});

// Game Over Handling
function handleGameOver(winnerId) {
    sounds.playWin();
    const winner = playersMap[winnerId];
    winnerTitle.textContent = winner ? `${winner.name.toUpperCase()} WINS!` : "GAME OVER";
    winnerSubtitle.textContent = winnerId === currentUser.uid ? "🎉 Outstanding Victory! You are the UNO Master!" : "Better luck next round!";

    statTurns.textContent = gameState?.totalTurns || 0;
    statCardsPlayed.textContent = gameState?.totalCardsPlayed || 0;

    winModal.classList.remove("hidden");
}

btnPlayAgain.addEventListener("click", () => {
    window.location.href = "index.html";
});

btnExitToLobby.addEventListener("click", () => {
    window.location.href = "index.html";
});

// Sound Toggle
btnSoundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    btnSoundToggle.textContent = soundEnabled ? "🔊" : "🔇";
});

// Leave Game
btnLeaveGame.addEventListener("click", async () => {
    if (confirm("Are you sure you want to exit the match?")) {
        if (currentUser && roomId) {
            await update(ref(db, `rooms/${roomId}/players/${currentUser.uid}`), { connected: false });
        }
        window.location.href = "index.html";
    }
});

function getColorHex(color) {
    switch (color) {
        case "red": return "#ED1C24";
        case "blue": return "#0072CE";
        case "green": return "#00A651";
        case "yellow": return "#FFDE17";
        default: return "#FFF";
    }
}