/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  if (window.allProductsCache) return window.allProductsCache;
  const response = await fetch("products.json");
  const data = await response.json();
  window.allProductsCache = data.products;
  return window.allProductsCache;
}

/* Selected products state */
const selectedProducts = new Map();

/* Conversation history for chat follow-ups */
const messages = [
  {
    role: "system",
    content:
      "You are a helpful beauty assistant specialized in L'Oréal products. Only answer questions about skincare, haircare, makeup, fragrance, product usage, routines, ingredients, and L'Oréal brand/product information. Use provided selected products and generated routines as context to give concise, practical guidance tailored to the user's skin/hair type when available. If the user asks about topics outside beauty/cosmetics/L'Oréal (for example politics, finance, legal advice, medical diagnosis beyond general cosmetic guidance, or unrelated technical questions), politely refuse with a short response such as: 'Sorry, I can only help with beauty and L'Oréal product questions. Please ask about skincare, haircare, makeup, fragrance, or product usage.' Do not provide medical, legal, or other professional advice—recommend a qualified professional when appropriate.",
  },
];

/* Prompt identifier to tell the worker which prebuilt prompt to use */
const PROMPT_ID = "pmpt_6903f2d96e2081939c6273ab361fb3760f15a6ced37d327a";

/* Helpers */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function appendMessageToChat(role, text) {
  // Normalize and trim incoming text to avoid trailing newlines or spaces
  const safeText = String(text == null ? "" : text).trim();
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message ${role}`;
  wrapper.innerHTML = `<div class="message-content">${escapeHtml(
    safeText
  ).replace(/\n/g, "<br>")}</div>`;
  chatWindow.appendChild(wrapper);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Persistence: save and restore selected product ids to localStorage */
const STORAGE_KEY = "selectedProductIds";

function saveSelectionsToStorage() {
  try {
    const ids = Array.from(selectedProducts.keys());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (e) {
    // ignore storage errors
    console.warn("Could not save selections:", e);
  }
}

async function restoreSelectionsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return;

    // ensure products are loaded
    await loadProducts();
    ids.forEach((id) => {
      const prod = (window.allProductsCache || []).find((p) => p.id === id);
      if (prod) selectedProducts.set(id, prod);
    });
    // update UI to reflect restored selections
    renderSelectedProducts();
    // mark selected cards currently in the DOM if any category is shown
    ids.forEach((id) => updateCardHighlight(id));
  } catch (e) {
    console.warn("Could not restore selections:", e);
  }
}

async function sendMessagesToAI(messagesArray) {
  // Forward the request to the Cloudflare Worker which acts as a secure proxy
  // so the client does not need to hold the OpenAI API key.
  const WORKER_URL = "https://loreal-chatbot.aocampo2533.workers.dev/";

  const resp = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    // Include the promptId so the worker can apply the saved system prompt/constraints there
    body: JSON.stringify({ messages: messagesArray, promptId: PROMPT_ID }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Worker error: ${resp.status} ${text}`);
  }

  const data = await resp.json();

  // Worker may proxy the OpenAI response or return a simplified payload.
  // Try several common places for assistant text so this is robust.
  const aiText =
    data?.content ||
    data?.text ||
    data?.answer ||
    data?.message ||
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    null;

  if (!aiText) {
    // If the worker returned another structure, include it for debugging.
    throw new Error("No assistant text returned from worker");
  }

  // Trim whitespace/newlines from the assistant text to avoid trailing LFs
  return String(aiText).trim();
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  if (!products || products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No products found in this category
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div class="product-card" data-id="${product.id}" tabindex="0">
      <div class="card-top">
        <img src="${product.image}" alt="${product.name}">
        <div class="product-info">
          <h3>${product.name}</h3>
          <p>${product.brand}</p>
          <button class="details-btn" data-id="${product.id}" aria-expanded="false">Details</button>
        </div>
      </div>
      <div class="product-description" hidden>${product.description}</div>
    </div>
  `
    )
    .join("");

  // attach handlers to cards
  document.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = Number(card.dataset.id);
      toggleSelection(id);
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const id = Number(card.dataset.id);
        toggleSelection(id);
      }
    });

    const productId = Number(card.dataset.id);
    if (selectedProducts.has(productId)) {
      card.classList.add("selected");
    } else {
      card.classList.remove("selected");
    }
  });

  // details handlers
  document.querySelectorAll(".details-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const card = document.querySelector(`.product-card[data-id="${id}"]`);
      if (!card) return;
      const desc = card.querySelector(".product-description");
      const expanded = btn.getAttribute("aria-expanded") === "true";
      if (expanded) {
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = "Details";
        desc.hidden = true;
      } else {
        btn.setAttribute("aria-expanded", "true");
        btn.textContent = "Hide";
        desc.hidden = false;
      }
    });

    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        btn.click();
      }
    });
  });
}

/* Toggle selection for a product id */
function toggleSelection(productId) {
  const product = (window.allProductsCache || []).find(
    (p) => p.id === productId
  );
  if (!product) return;

  if (selectedProducts.has(productId)) selectedProducts.delete(productId);
  else selectedProducts.set(productId, product);

  updateCardHighlight(productId);
  renderSelectedProducts();
  saveSelectionsToStorage();
}

/* Add or remove .selected class for card matching id */
function updateCardHighlight(productId) {
  const card = document.querySelector(`.product-card[data-id="${productId}"]`);
  if (!card) return;
  if (selectedProducts.has(productId)) card.classList.add("selected");
  else card.classList.remove("selected");
}

/* Render the selected products chips/list and attach remove handlers */
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineBtn = document.getElementById("generateRoutine");

function renderSelectedProducts() {
  if (selectedProducts.size === 0) {
    selectedProductsList.innerHTML = `<div class="placeholder-message">No products selected yet</div>`;
    generateRoutineBtn.disabled = true;
    return;
  }

  generateRoutineBtn.disabled = false;

  selectedProductsList.innerHTML = Array.from(selectedProducts.values())
    .map(
      (p) => `
      <div class="selected-chip" data-id="${p.id}">
        <img src="${p.image}" alt="${p.name}" />
        <div class="chip-info">
          <strong>${p.name}</strong>
          <div class="chip-brand">${p.brand}</div>
        </div>
        <button class="remove-btn" aria-label="Remove ${p.name}" data-id="${p.id}">&times;</button>
      </div>
    `
    )
    .join("");

  selectedProductsList.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = Number(btn.dataset.id);
      selectedProducts.delete(id);
      updateCardHighlight(id);
      renderSelectedProducts();
      saveSelectionsToStorage();
      e.stopPropagation();
    });
  });
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const products = await loadProducts();
  const selectedCategory = e.target.value;
  const filteredProducts = products.filter(
    (product) => product.category === selectedCategory
  );
  displayProducts(filteredProducts);
});

/* Chat form submission handler - use conversation history */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("userInput");
  const text = (input.value || "").trim();
  if (!text) return;

  messages.push({ role: "user", content: text });
  appendMessageToChat("user", text);
  input.value = "";

  sendBtn.disabled = true;
  generateRoutineBtn.disabled = true;
  appendMessageToChat("assistant", "Thinking...");

  try {
    const aiText = await sendMessagesToAI(messages);
    const assistants = chatWindow.querySelectorAll(".chat-message.assistant");
    if (assistants.length) assistants[assistants.length - 1].remove();

    appendMessageToChat("assistant", aiText);
    messages.push({ role: "assistant", content: aiText });
  } catch (err) {
    console.error(err);
    appendMessageToChat("assistant", `Error: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
    generateRoutineBtn.disabled = false;
  }
});

// Initial render for selected list
renderSelectedProducts();

// Restore persisted selections on page load
window.addEventListener("load", () => {
  restoreSelectionsFromStorage();
});

// Clear all selections button
const clearBtn = document.getElementById("clearSelections");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    selectedProducts.clear();
    // remove visual highlights
    document
      .querySelectorAll(".product-card.selected")
      .forEach((c) => c.classList.remove("selected"));
    renderSelectedProducts();
    saveSelectionsToStorage();
  });
}

/* Generate routine: collect selected products, push as a user message, and call AI. */
generateRoutineBtn.addEventListener("click", async () => {
  const selected = Array.from(selectedProducts.values()).map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    description: p.description,
  }));

  if (selected.length === 0) {
    appendMessageToChat(
      "assistant",
      "Select at least one product to generate a routine."
    );
    return;
  }

  const userContent = `Here are the selected products in JSON format:\n${JSON.stringify(
    selected,
    null,
    2
  )}\n\nPlease provide a human-readable routine describing the order of use, recommended frequency (AM/PM/daily/weekly), and any important cautions.`;

  messages.push({ role: "user", content: userContent });
  appendMessageToChat("user", "(Selected products) See the list you provided.");

  appendMessageToChat("assistant", "Generating routine...");
  generateRoutineBtn.disabled = true;
  sendBtn.disabled = true;

  try {
    const aiText = await sendMessagesToAI(messages);
    const assistants = chatWindow.querySelectorAll(".chat-message.assistant");
    if (assistants.length) assistants[assistants.length - 1].remove();

    appendMessageToChat("assistant", aiText);
    messages.push({ role: "assistant", content: aiText });
  } catch (err) {
    console.error(err);
    appendMessageToChat(
      "assistant",
      `Error generating routine: ${err.message}`
    );
  } finally {
    generateRoutineBtn.disabled = false;
    sendBtn.disabled = false;
  }
});
