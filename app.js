import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const form = document.querySelector("#terms-form");
const submitButton = document.querySelector("#submit-button");
const submittedState = document.querySelector("#submitted-state");
const errorMessage = document.querySelector("#error-message");
const cloudCanvas = document.querySelector("#cloud-canvas");
const participantCount = document.querySelector("#participant-count");
const associationCount = document.querySelector("#association-count");
const refreshButton = document.querySelector("#refresh-button");
const toast = document.querySelector("#toast");
const wordTooltip = document.querySelector("#word-tooltip");

const palette = ["#ffd43b", "#5eead4", "#fda4af", "#93c5fd", "#f8fafc", "#c4b5fd"];
const MAX_VISIBLE_WORDS = 55;
const MAX_PLACEMENT_ATTEMPTS = 420;
let latestWords = [];
let toastTimer;

function showToast(message, type = "success") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function normalize(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("hu-HU");
}

function getClientId() {
  const key = "vizkozosseg-client-id";
  const stored = window.localStorage.getItem(key);
  if (stored) return stored;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

function hashWord(word) {
  return [...word].reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0);
}

function aggregate(snapshot) {
  const frequencies = new Map();
  snapshot.forEach((response) => {
    const words = Array.isArray(response.data().words) ? response.data().words : [];
    words.forEach((word) => {
      if (typeof word !== "string") return;
      const key = normalize(word);
      const current = frequencies.get(key) ?? { text: word.trim(), count: 0 };
      current.count += 1;
      frequencies.set(key, current);
    });
  });
  return [...frequencies.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "hu"));
}

function createCloudGeometry(width, height) {
  const horizontalPadding = Math.max(10, width * 0.025);
  const verticalPadding = Math.max(8, height * 0.025);
  return {
    width: Math.max(120, width - horizontalPadding * 2),
    height: Math.max(180, height - verticalPadding * 2),
    left: horizontalPadding,
    top: verticalPadding,
    centerX: width / 2,
    centerY: height / 2,
  };
}

function boxInsideCloud(box, geometry) {
  return box.left >= geometry.left &&
    box.right <= geometry.left + geometry.width &&
    box.top >= geometry.top &&
    box.bottom <= geometry.top + geometry.height;
}

function boxesCollide(box, boxes) {
  return boxes.some((placed) => !(
    box.right < placed.left ||
    box.left > placed.right ||
    box.bottom < placed.top ||
    box.top > placed.bottom
  ));
}

function pseudoRandom(value) {
  const result = Math.sin(value * 12.9898) * 43758.5453;
  return result - Math.floor(result);
}

function getWordRotation(word, wordIndex) {
  if (wordIndex < 3) return 0;
  return Math.abs(hashWord(word.text)) % 6 === 0 ? -90 : 0;
}

function measureWord(word, fontSize, measure, rotation = 0) {
  measure.font = `800 ${fontSize}px Arial`;
  const textWidth = measure.measureText(word.text).width * 0.97;
  return {
    width: rotation === 0 ? textWidth : fontSize,
    height: rotation === 0 ? fontSize : textWidth,
    elementWidth: textWidth,
    elementHeight: fontSize,
  };
}

function findPosition(word, wordIndex, fontSize, boxes, geometry, measure) {
  const rotation = getWordRotation(word, wordIndex);
  const dimensions = measureWord(word, fontSize, measure, rotation);
  const seed = Math.abs(hashWord(word.text)) + wordIndex * 97;
  const seedAngle = pseudoRandom(seed) * Math.PI * 2;

  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) {
    const progress = Math.sqrt(attempt / Math.max(1, MAX_PLACEMENT_ATTEMPTS - 1));
    const angle = seedAngle + attempt * 2.3999632;
    const horizontalRadius = Math.max(0, (geometry.width - dimensions.width) / 2);
    const verticalRadius = Math.max(0, (geometry.height - dimensions.height) / 2);
    const centerX = geometry.centerX + Math.cos(angle) * progress * horizontalRadius;
    const centerY = geometry.centerY + Math.sin(angle) * progress * verticalRadius;
    const box = {
      left: centerX - dimensions.width / 2 - 1,
      right: centerX + dimensions.width / 2 + 1,
      top: centerY - dimensions.height / 2 - 0.6,
      bottom: centerY + dimensions.height / 2 + 0.6,
    };

    if (!boxInsideCloud(box, geometry) || boxesCollide(box, boxes)) continue;
    return {
      box,
      x: centerX - dimensions.elementWidth / 2,
      y: centerY - dimensions.elementHeight / 2,
      fontSize,
      rotation,
    };
  }

  return null;
}

function calculateIdealSizes(words, geometry) {
  const maxCount = Math.max(...words.map((word) => word.count));
  const usableAreaPerWord = (geometry.width * geometry.height * 0.52) / Math.max(1, words.length);
  const densitySize = Math.sqrt(usableAreaPerWord);
  const minimum = Math.max(10, Math.min(24, densitySize * 0.42));
  const maximum = Math.max(minimum + 5, Math.min(72, densitySize * 1.12));

  return words.map((word) => {
    const ratio = maxCount === 1 ? 0.45 : Math.log(word.count + 1) / Math.log(maxCount + 1);
    return minimum + ratio * (maximum - minimum);
  });
}

function createLayout(words, geometry, measure) {
  const idealSizes = calculateIdealSizes(words, geometry);

  for (let globalScale = 1; globalScale >= 0.34; globalScale -= 0.05) {
    const boxes = [];
    const placements = [];
    let complete = true;

    for (let index = 0; index < words.length; index += 1) {
      const idealSize = idealSizes[index] * globalScale;
      let placement = null;

      for (let retryScale = 1; retryScale >= 0.42 && !placement; retryScale -= 0.1) {
        const fontSize = Math.max(7, idealSize * retryScale);
        placement = findPosition(words[index], index, fontSize, boxes, geometry, measure);
      }

      if (!placement) {
        complete = false;
        break;
      }

      boxes.push(placement.box);
      placements.push(placement);
    }

    if (complete) return placements;
  }

  for (const emergencySize of [6, 5, 4]) {
    const boxes = [];
    const placements = [];
    let complete = true;

    for (let index = 0; index < words.length; index += 1) {
      const placement = findPosition(words[index], index, emergencySize, boxes, geometry, measure);
      if (!placement) {
        complete = false;
        break;
      }
      boxes.push(placement.box);
      placements.push(placement);
    }

    if (complete) return placements;
  }

  // Extrém hosszú kifejezéseknél is ugyanazt a szókészletet tartjuk meg.
  return words.map((word, index) => {
    const rotation = getWordRotation(word, index);
    const dimensions = measureWord(word, 4, measure, rotation);
    const availableWidth = Math.max(0, geometry.width - dimensions.width);
    const availableHeight = Math.max(0, geometry.height - dimensions.height);
    return {
      x: geometry.left + pseudoRandom(index * 19.37) * availableWidth + (dimensions.width - dimensions.elementWidth) / 2,
      y: geometry.top + pseudoRandom(index * 31.73) * availableHeight + (dimensions.height - dimensions.elementHeight) / 2,
      fontSize: 4,
      rotation,
    };
  });
}

function hideWordTooltip() {
  wordTooltip.hidden = true;
}

function showWordTooltip(word, clientX, clientY) {
  wordTooltip.textContent = `${word.count} beküldés`;
  wordTooltip.hidden = false;

  const tooltipBox = wordTooltip.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - tooltipBox.width - 8, clientX + 12));
  let top = clientY + 12;
  if (top + tooltipBox.height > window.innerHeight - 8) top = clientY - tooltipBox.height - 12;
  wordTooltip.style.left = `${left}px`;
  wordTooltip.style.top = `${Math.max(8, top)}px`;
}

function appendWord(word, placement) {
  const element = document.createElement("span");
  element.className = "cloud-word";
  element.style.left = `${placement.x}px`;
  element.style.top = `${placement.y}px`;
  element.style.fontSize = `${placement.fontSize}px`;
  element.style.setProperty("--word-rotation", `${placement.rotation}deg`);
  element.style.color = palette[Math.abs(hashWord(word.text)) % palette.length];
  element.tabIndex = 0;
  element.setAttribute("aria-label", `${word.text}: ${word.count} beküldés`);
  element.append(document.createTextNode(word.text));
  element.addEventListener("pointerenter", (event) => showWordTooltip(word, event.clientX, event.clientY));
  element.addEventListener("pointermove", (event) => showWordTooltip(word, event.clientX, event.clientY));
  element.addEventListener("pointerleave", hideWordTooltip);
  element.addEventListener("pointercancel", hideWordTooltip);
  element.addEventListener("focus", () => {
    const box = element.getBoundingClientRect();
    showWordTooltip(word, box.left + box.width / 2, box.top + box.height / 2);
  });
  element.addEventListener("blur", hideWordTooltip);
  cloudCanvas.append(element);
}

function renderCloud(words) {
  latestWords = words;
  hideWordTooltip();
  cloudCanvas.replaceChildren();
  if (!words.length) {
    const empty = document.createElement("div");
    empty.className = "empty-cloud";
    empty.innerHTML = '<span class="cloud-icon" aria-hidden="true">☁</span><strong>A közös tér még üres</strong><span>Az első három kifejezés itt válik láthatóvá.</span>';
    cloudCanvas.append(empty);
    return;
  }

  const visibleWords = words.slice(0, MAX_VISIBLE_WORDS);
  const geometry = createCloudGeometry(cloudCanvas.clientWidth, cloudCanvas.clientHeight);
  const measure = document.createElement("canvas").getContext("2d");
  const placements = createLayout(visibleWords, geometry, measure);

  if (placements) {
    visibleWords.forEach((word, index) => appendWord(word, placements[index]));
  }
}

function updateFromSnapshot(snapshot) {
  participantCount.textContent = String(snapshot.size);
  associationCount.textContent = String(snapshot.docs.reduce((sum, response) => sum + (Array.isArray(response.data().words) ? response.data().words.length : 0), 0));
  renderCloud(aggregate(snapshot));
  showError("");
}

function showSubmitted() {
  form.hidden = true;
  submittedState.hidden = false;
}

const configured = Object.values(firebaseConfig).every((value) => value && !String(value).startsWith("PASTE_"));

if (!configured) {
  submitButton.disabled = true;
  showError("A Firebase-kapcsolat konfigurációja még hiányzik. A projektgazda a README lépései alapján tudja aktiválni.");
} else {
  const app = initializeApp(firebaseConfig);
  const database = getFirestore(app);
  const responses = collection(database, "responses");

  if (window.localStorage.getItem("vizkozosseg-submitted") === "true") showSubmitted();

  onSnapshot(responses, updateFromSnapshot, () => {
    showError("Az élő Firebase-kapcsolat átmenetileg megszakadt.");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const terms = [...form.querySelectorAll("input")].map((input) => input.value.trim().replace(/\s+/g, " "));
    if (terms.some((term) => term.length < 2 || term.length > 40)) {
      showError("Mindhárom kifejezés 2–40 karakter hosszú legyen.");
      return;
    }
    if (new Set(terms.map(normalize)).size !== 3) {
      showError("A három kifejezés legyen különböző.");
      return;
    }

    submitButton.disabled = true;
    submitButton.querySelector("span:first-child").textContent = "Beküldés…";
    try {
      const clientId = getClientId();
      await setDoc(doc(database, "responses", clientId), { words: terms, createdAt: serverTimestamp() });
      window.localStorage.setItem("vizkozosseg-submitted", "true");
      showSubmitted();
      showError("");
      showToast("Köszönjük — bekerültél a közös szófelhőbe.");
    } catch {
      showError("A beküldés nem sikerült. Lehet, hogy erről az eszközről már érkezett válasz.");
      submitButton.disabled = false;
      submitButton.querySelector("span:first-child").textContent = "Beküldöm a közös térbe";
    }
  });

  refreshButton.addEventListener("click", async () => {
    refreshButton.classList.add("spinning");
    try {
      updateFromSnapshot(await getDocs(responses));
      showToast("A szófelhő frissült.");
    } catch {
      showError("A frissítés most nem sikerült.");
    } finally {
      window.setTimeout(() => refreshButton.classList.remove("spinning"), 450);
    }
  });
}

let resizeTimer;
new ResizeObserver(() => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => renderCloud(latestWords), 100);
}).observe(cloudCanvas);
