
/*
 * GOAT SPORTS — CLIENT ARTWORK LIBRARY
 * Admin-only client artwork management
 * Backend: Supabase + Monday.com
 */

(function () {
  "use strict";

  const API_URL =
    "https://qpavspvpdebtbbffdcmo.supabase.co/functions/v1/goat-artwork-library";

  const PUBLISHABLE_KEY =
    "sb_publishable_NoP_3R4R1WeoM7tivVJPAA_i4flKD1b";

  let libraryData = null;
  let selectedClient = null;
  let searchTerm = "";

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function getToken() {
    if (typeof customerToken !== "function") {
      throw new Error("GOAT Sports customer login is unavailable.");
    }

    const token = customerToken();

    if (!token) {
      throw new Error("Please sign in to GOAT Sports first.");
    }

    return token;
  }

  async function api(action, payload = {}) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: PUBLISHABLE_KEY,
        Authorization: "Bearer " + getToken()
      },
      body: JSON.stringify({ action, ...payload })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Artwork library unavailable.");
    }

    return data;
  }

  function installStyles() {
    if (document.getElementById("goatArtworkStyles")) return;

    const style = document.createElement("style");
    style.id = "goatArtworkStyles";

    style.textContent = `
      #goatArtworkModal {
        position: fixed;
        inset: 0;
        z-index: 99999;
        background: rgba(0,0,0,.75);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }

      #goatArtworkModal.open {
        display: flex;
      }

      #goatArtworkPanel {
        width: min(1100px, 100%);
        max-height: 94vh;
        overflow-y: auto;
        background: #f7f6fa;
        color: #24212a;
        border-radius: 14px;
        font-family: Arial, sans-serif;
      }

      .goatArtHeader {
        background: #683695;
        color: white;
        padding: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 15px;
        position: sticky;
        top: 0;
        z-index: 2;
      }

      .goatArtHeader strong {
        font-size: 20px;
      }

      .goatArtBody {
        padding: 22px;
      }

      .goatArtSearch {
        width: 100%;
        box-sizing: border-box;
        padding: 14px;
        margin: 15px 0 20px;
        border: 1px solid #ccc;
        border-radius: 8px;
        font-size: 15px;
      }

      .goatArtGrid {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(220px, 1fr)
        );
        gap: 14px;
      }

      .goatArtClient {
        background: white;
        border: 1px solid #ddd;
        border-radius: 10px;
        padding: 20px;
        text-align: left;
        cursor: pointer;
        color: #24212a;
      }

      .goatArtClient:hover {
        border-color: #683695;
        box-shadow: 0 4px 15px rgba(104,54,149,.12);
      }

      .goatArtClient strong {
        display: block;
        font-size: 17px;
        margin-bottom: 8px;
      }

      .goatArtMuted {
        font-size: 12px;
        color: #777;
      }

      .goatArtJob,
      .goatArtProof {
        background: white;
        border: 1px solid #ddd;
        border-radius: 10px;
        padding: 16px;
        margin-top: 14px;
      }

      .goatArtProof {
        background: #fafafa;
      }

      .goatArtStatus {
        display: inline-block;
        background: #e5f5f1;
        color: #08766b;
        border-radius: 20px;
        padding: 5px 10px;
        margin: 8px 0;
        font-size: 11px;
        font-weight: bold;
      }

      .goatArtButton {
        background: #109488;
        color: white;
        border: 0;
        padding: 11px 15px;
        border-radius: 7px;
        font-weight: bold;
        cursor: pointer;
        margin: 6px 8px 6px 0;
      }

      .goatArtBack {
        background: #e7dff1;
        color: #683695;
      }

      .goatArtClose {
        background: white;
        color: #683695;
        border: 0;
        padding: 10px 15px;
        border-radius: 7px;
        cursor: pointer;
      }

      .goatArtLink {
        display: inline-block;
        color: #683695;
        font-size: 12px;
        margin-top: 8px;
      }

      .goatArtAdminLaunch {
        display: inline-block;
        background: #683695;
        color: white;
        border: 0;
        border-radius: 7px;
        padding: 12px 16px;
        margin: 10px 0;
        font-weight: bold;
        cursor: pointer;
      }
    `;

    document.head.appendChild(style);
  }

  function ensureModal() {
    let modal = document.getElementById("goatArtworkModal");

    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "goatArtworkModal";

    modal.innerHTML = `
      <section id="goatArtworkPanel"
               role="dialog"
               aria-modal="true"
               aria-label="GOAT Sports Client Artwork Library">
        <div class="goatArtHeader">
          <strong>GOAT SPORTS · CLIENT ARTWORK LIBRARY</strong>
          <button class="goatArtClose"
                  id="goatArtCloseButton">
            CLOSE ✕
          </button>
        </div>
        <div class="goatArtBody"
             id="goatArtworkBody"></div>
      </section>
    `;

    document.body.appendChild(modal);

    document.getElementById("goatArtCloseButton")
      .addEventListener("click", closeLibrary);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeLibrary();
    });

    return modal;
  }

  function bodyElement() {
    return document.getElementById("goatArtworkBody");
  }

  async function openLibrary() {
    if (
      typeof lockerSession === "undefined" ||
      !lockerSession ||
      lockerSession.adminRole !== "master_admin"
    ) {
      alert("GOAT Sports master admin access is required.");
      return;
    }

    installStyles();
    ensureModal().classList.add("open");

    bodyElement().innerHTML =
      "<p>Loading clients and artwork from Monday.com...</p>";

    try {
      libraryData = await api("list");
      selectedClient = null;
      renderLibrary();
    } catch (error) {
      bodyElement().innerHTML = `
        <h3>Unable to load artwork</h3>
        <p>${escapeHTML(error.message)}</p>
        <button class="goatArtButton"
                id="goatArtRetry">
          TRY AGAIN
        </button>
      `;

      document.getElementById("goatArtRetry")
        .addEventListener("click", openLibrary);
    }
  }

  function closeLibrary() {
    document.getElementById("goatArtworkModal")
      ?.classList.remove("open");
  }

  function renderLibrary() {
    if (!libraryData) return;

    const client = (libraryData.clients || [])
      .find((item) => String(item.id) === selectedClient);

    if (client) {
      renderClient(client);
    } else {
      renderDirectory();
    }
  }

  function renderDirectory() {
    const clients = libraryData.clients || [];
    const term = searchTerm.trim().toLowerCase();

    const filtered = clients.filter((client) => {
      return (
        client.name.toLowerCase().includes(term) ||
        String(client.clientId || "")
          .toLowerCase().includes(term) ||
        (client.jobs || []).some((job) =>
          String(job.name || "")
            .toLowerCase().includes(term) ||
          String(job.jobCode || "")
            .toLowerCase().includes(term)
        )
      );
    });

    bodyElement().innerHTML = `
      <h2>CLIENT ARTWORK</h2>
      <p class="goatArtMuted">
        ${clients.length} CRM clients ·
        ${libraryData.counts?.artwork || 0} artwork versions
      </p>

      <input
        id="goatArtSearch"
        class="goatArtSearch"
        placeholder="Search client or job number..."
        value="${escapeHTML(searchTerm)}"
      >

      <div class="goatArtGrid">
        ${filtered.map((client) => `
          <button class="goatArtClient"
                  data-client-id="${escapeHTML(client.id)}">
            <strong>📁 ${escapeHTML(client.name)}</strong>
            <span class="goatArtMuted">
              ${(client.jobs || []).length} jobs ·
              ${(client.artworks || []).length} artwork versions
            </span>
          </button>
        `).join("")}
      </div>

      ${libraryData.counts?.unassigned ? `
        <p class="goatArtMuted" style="margin-top:20px">
          ${libraryData.counts.unassigned} artwork versions
          still need a linked job or client.
        </p>
      ` : ""}
    `;

    const input = document.getElementById("goatArtSearch");

    input.addEventListener("input", (event) => {
      searchTerm = event.target.value;
      const cursor = event.target.selectionStart;

      renderDirectory();

      const replacement = document.getElementById("goatArtSearch");
      replacement.focus();
      replacement.setSelectionRange(cursor, cursor);
    });

    bodyElement().querySelectorAll("[data-client-id]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          selectedClient = button.dataset.clientId;
          renderLibrary();
        });
      });
  }

  function renderClient(client) {
    const jobs = client.jobs || [];

    bodyElement().innerHTML = `
      <button class="goatArtButton goatArtBack"
              id="goatArtBack">
        ← ALL CLIENTS
      </button>

      <h2>${escapeHTML(client.name)}</h2>

      <p class="goatArtMuted">
        ${(client.artworks || []).length} artwork versions ·
        ${jobs.length} jobs
      </p>

      ${jobs.length ? jobs.map((job) => `
        <section class="goatArtJob">
          <h3>${escapeHTML(job.name)}</h3>

          <p class="goatArtMuted">
            ${escapeHTML(job.jobCode || "Job")} ·
            ${(job.artworks || []).length} artwork versions
          </p>

          ${(job.artworks || []).length
            ? job.artworks.map(renderArtwork).join("")
            : `<p class="goatArtMuted">
                 No artwork uploaded for this job yet.
               </p>`
          }
        </section>
      `).join("") : `
        <p class="goatArtMuted">
          No jobs linked to this client yet.
        </p>
      `}
    `;

    document.getElementById("goatArtBack")
      .addEventListener("click", () => {
        selectedClient = null;
        renderDirectory();
      });

    bodyElement().querySelectorAll("[data-art-asset]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          downloadAsset(button.dataset.artAsset);
        });
      });
  }

  function renderArtwork(artwork) {
    const files = artwork.files || [];

    return `
      <div class="goatArtProof">
        <strong>${escapeHTML(artwork.title)}</strong>

        <div>
          <span class="goatArtStatus">
            ${escapeHTML(artwork.status || "Draft")}
          </span>

          <span class="goatArtMuted">
            Version ${escapeHTML(artwork.version || "—")}
            ${escapeHTML(artwork.uploaded || "")}
          </span>
        </div>

        <div>
          ${files.length ? files.map((file) => `
            <button
              class="goatArtButton"
              data-art-asset="${escapeHTML(file.id)}">
              ↓ ${escapeHTML(file.name)}
            </button>
          `).join("") : `
            <span class="goatArtMuted">
              No artwork file attached
            </span>
          `}
        </div>

        <a class="goatArtLink"
           href="${escapeHTML(artwork.url)}"
           target="_blank"
           rel="noopener noreferrer">
          OPEN IN MONDAY.COM ↗
        </a>
      </div>
    `;
  }

  async function downloadAsset(assetId) {
    // Open a blank tab immediately to avoid popup blockers.
    const tab = window.open("about:blank", "_blank");

    try {
      const result = await api("file", { assetId });

      if (!result.url) {
        throw new Error("Artwork download link unavailable.");
      }

      if (tab) {
        tab.location.href = result.url;
      } else {
        alert("Allow popups to download artwork.");
      }
    } catch (error) {
      if (tab) tab.close();
      alert(error.message);
    }
  }

  function installAdminButton() {
    if (document.getElementById("goatArtworkLaunch")) return;

    const adminButton = document.querySelector(
      'button[onclick="openLockerAdmin()"]'
    );

    if (!adminButton) return;

    const button = document.createElement("button");

    button.id = "goatArtworkLaunch";
    button.type = "button";
    button.className = "goatArtAdminLaunch";
    button.textContent = "CLIENT ARTWORK LIBRARY";

    button.addEventListener("click", openLibrary);

    adminButton.insertAdjacentElement("afterend", button);
  }

  // The existing GOAT Sports dashboard renders dynamically.
  // Observe its updates so the admin button is added when ready.
  let pending = false;

  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;

    requestAnimationFrame(() => {
      pending = false;
      installAdminButton();
    });
  });

  function initialize() {
    installStyles();
    installAdminButton();

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }

})();
