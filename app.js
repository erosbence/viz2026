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

const palette = ["#ffd43b", "#5eead4", "#fda4af", "#93c5fd", "#f8fafc", "#c4b5fd"];
const MAX_VISIBLE_WORDS = 45;
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

function createBulbGeometry(width, height) {
  const availableWidth = Math.max(120, width - 20);
  const availableHeight = Math.max(180, height - 16);
  const bulbHeight = Math.min(availableHeight, availableWidth * 1.32);
  const bulbWidth = Math.min(availableWidth, bulbHeight / 1.32);
  return {
    width: bulbWidth,
    height: bulbHeight,
    left: (width - bulbWidth) / 2,
    top: (height - bulbHeight) / 2,
    centerX: width / 2,
  };
}

function bulbHalfWidth(verticalPosition) {
  const t = Math.max(0, Math.min(1, verticalPosition));
  const ellipseDistance = (t - 0.3) / 0.3;
  const head = Math.abs(ellipseDistance) <= 1
    ? 0.48 * Math.sqrt(1 - ellipseDistance ** 2)
    : 0;
  const taper = t >= 0.47 && t <= 0.75
    ? 0.34 + ((t - 0.47) / 0.28) * (0.2 - 0.34)
    : 0;
  const socket = t >= 0.72 && t <= 0.94 ? 0.205 : 0;
  const base = t > 0.94 ? 0.08 + 0.125 * Math.sqrt(Math.max(0, 1 - ((t - 0.94) / 0.06) ** 2)) : 0;
  return Math.max(head, taper, socket, base);
}

function pointInsideBulb(x, y, geometry) {
  const t = (y - geometry.top) / geometry.height;
  if (t < 0 || t > 1) return false;
  const horizontalPosition = Math.abs(x - geometry.centerX) / geometry.width;
  return horizontalPosition <= bulbHalfWidth(t);
}

function boxInsideBulb(box, geometry) {
  const inset = 1;
  const points = [
    [box.left + inset, box.top + inset],
    [box.right - inset, box.top + inset],
    [box.left + inset, box.bottom - inset],
    [box.right - inset, box.bottom - inset],
    [(box.left + box.right) / 2, box.top + inset],
    [(box.left + box.right) / 2, box.bottom - inset],
  ];
  return points.every(([x, y]) => pointInsideBulb(x, y, geometry));
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

function measureWord(word, fontSize, measure) {
  measure.font = `800 ${fontSize}px Arial`;
  const labelWidth = measure.measureText(word.text).width;
  const countWidth = String(word.count).length * fontSize * 0.14;
  return {
    width: labelWidth + fontSize * 0.25 + countWidth,
    height: fontSize * 1.08,
  };
}

function findPosition(word, wordIndex, fontSize, boxes, geometry, measure) {
  const dimensions = measureWord(word, fontSize, measure);
  const seed = Math.abs(hashWord(word.text)) + wordIndex * 97;

  for (let attempt = 0; attempt < 1400; attempt += 1) {
    const vertical = 0.035 + pseudoRandom(seed + attempt * 1.6180339) * 0.94;
    const halfWidth = bulbHalfWidth(vertical) * geometry.width;
    const horizontal = (pseudoRandom(seed * 0.37 + attempt * 2.4142136) * 2 - 1) * halfWidth;
    const centerX = geometry.centerX + horizontal;
    const centerY = geometry.top + vertical * geometry.height;
    const box = {
      left: centerX - dimensions.width / 2 - 3,
      right: centerX + dimensions.width / 2 + 3,
      top: centerY - dimensions.height / 2 - 2,
      bottom: centerY + dimensions.height / 2 + 2,
    };

    if (!boxInsideBulb(box, geometry) || boxesCollide(box, boxes)) continue;
    return { box, x: centerX - dimensions.width / 2, y: centerY - dimensions.height / 2, fontSize };
  }

  return null;
}

function calculateIdealSizes(words, geometry) {
  const maxCount = Math.max(...words.map((word) => word.count));
  const usableAreaPerWord = (geometry.width * geometry.height * 0.43) / Math.max(1, words.length);
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

  for (let globalScale = 1; globalScale >= 0.34; globalScale -= 0.08) {
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
    const vertical = 0.08 + (index / Math.max(1, words.length - 1)) * 0.84;
    const horizontalRange = bulbHalfWidth(vertical) * geometry.width * 0.72;
    const centerX = geometry.centerX + (pseudoRandom(index * 19.37) * 2 - 1) * horizontalRange;
    const centerY = geometry.top + vertical * geometry.height;
    const dimensions = measureWord(word, 4, measure);
    return {
      x: centerX - dimensions.width / 2,
      y: centerY - dimensions.height / 2,
      fontSize: 4,
    };
  });
}

function appendBulbGuide(geometry) {
  const namespace = "http://www.w3.org/2000/svg";
  const guide = document.createElementNS(namespace, "svg");
  guide.classList.add("bulb-guide");
  guide.setAttribute("viewBox", "0 0 100 132");
  guide.setAttribute("aria-hidden", "true");
  guide.style.left = `${geometry.left}px`;
  guide.style.top = `${geometry.top}px`;
  guide.style.width = `${geometry.width}px`;
  guide.style.height = `${geometry.height}px`;
  guide.innerHTML = `
    <path d="M50 3C24 3 6 21 6 43c0 18 10 27 23 39 5 5 7 10 7 15h28c0-5 2-10 7-15 13-12 23-21 23-39C94 21 76 3 50 3Z" />
    <path d="M34 96h32v23c0 7-7 11-16 11s-16-4-16-11V96Z" />
    <path class="bulb-detail" d="M35 105h30M35 113h30M38 121h24" />`;
  cloudCanvas.append(guide);
}

function appendWord(word, placement) {
  const element = document.createElement("span");
  element.className = "cloud-word";
  element.style.left = `${placement.x}px`;
  element.style.top = `${placement.y}px`;
  element.style.fontSize = `${placement.fontSize}px`;
  element.style.color = palette[Math.abs(hashWord(word.text)) % palette.length];
  element.title = `${word.count} beküldés`;
  element.append(document.createTextNode(word.text));
  const count = document.createElement("small");
  count.textContent = String(word.count);
  element.append(count);
  cloudCanvas.append(element);
}

function renderCloud(words) {
  latestWords = words;
  cloudCanvas.replaceChildren();
  if (!words.length) {
    const empty = document.createElement("div");
    empty.className = "empty-cloud";
    empty.innerHTML = '<span class="cloud-icon" aria-hidden="true">☁</span><strong>A közös tér még üres</strong><span>Az első három kifejezés itt válik láthatóvá.</span>';
    cloudCanvas.append(empty);
    return;
  }

  const visibleWords = words.slice(0, MAX_VISIBLE_WORDS);
  const geometry = createBulbGeometry(cloudCanvas.clientWidth, cloudCanvas.clientHeight);
  const measure = document.createElement("canvas").getContext("2d");
  const placements = createLayout(visibleWords, geometry, measure);

  appendBulbGuide(geometry);
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
