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

  const width = cloudCanvas.clientWidth;
  const height = cloudCanvas.clientHeight;
  const maxCount = Math.max(...words.map((word) => word.count));
  const minSide = Math.min(width, height);
  const boxes = [];
  const measure = document.createElement("canvas").getContext("2d");

  words.slice(0, 55).forEach((word) => {
    const ratio = maxCount === 1 ? 0.45 : Math.log(word.count + 1) / Math.log(maxCount + 1);
    const fontSize = Math.max(17, Math.min(72, 17 + ratio * Math.min(54, minSide * 0.09)));
    measure.font = `700 ${fontSize}px Arial`;
    const wordWidth = Math.min(measure.measureText(word.text).width, width * 0.72);
    const wordHeight = fontSize * 1.08;

    for (let step = 0; step < 900; step += 1) {
      const angle = step * 0.43;
      const radius = 2.4 * Math.sqrt(step);
      const x = width / 2 + Math.cos(angle) * radius * 2.15 - wordWidth / 2;
      const y = height / 2 + Math.sin(angle) * radius * 1.55 - wordHeight / 2;
      const box = { left: x - 5, right: x + wordWidth + 5, top: y - 3, bottom: y + wordHeight + 3 };
      const inside = box.left > 9 && box.right < width - 9 && box.top > 9 && box.bottom < height - 9;
      const collides = boxes.some((placed) => !(box.right < placed.left || box.left > placed.right || box.bottom < placed.top || box.top > placed.bottom));
      if (!inside || collides) continue;

      boxes.push(box);
      const element = document.createElement("span");
      element.className = "cloud-word";
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.fontSize = `${fontSize}px`;
      element.style.color = palette[Math.abs(hashWord(word.text)) % palette.length];
      element.title = `${word.count} beküldés`;
      element.append(document.createTextNode(word.text));
      const count = document.createElement("small");
      count.textContent = String(word.count);
      element.append(count);
      cloudCanvas.append(element);
      break;
    }
  });
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
