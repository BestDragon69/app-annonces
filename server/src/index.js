const API_URL = "http://localhost:3001/api";
let currentUser = JSON.parse(localStorage.getItem("user")) || null;

// On utilise uniquement le localStorage pour stocker l'utilisateur,
// pas le token, car le backend gère la session via des cookies HttpOnly.
let token = null;

const fallbackImages = {
  Véhicules: "https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?w=500",
  Immobilier:
    "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=500",
  Électronique:
    "https://images.unsplash.com/photo-1588508065123-287b28e013da?w=500",
  Mode: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=500",
  "Maison & Jardin":
    "https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=500",
  "Sports & Loisirs":
    "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=500",
  "Livres & Médias":
    "https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=500",
};

document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  loadCategories();
  loadAds();
  setupEventListeners();
});

// --- GESTION DES VUES ---
function showView(viewId) {
  [
    "view-home",
    "view-auth",
    "view-create-ad",
    "view-messages",
    "view-dashboard",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });
  const currentView = document.getElementById(viewId);
  if (currentView) currentView.classList.remove("hidden");
}

// --- NAVIGATION DYNAMIQUE ---
function setupNavigation() {
  const nav = document.getElementById("nav-menu");
  if (!nav) return;
  nav.innerHTML = "";

  if (currentUser) {
    nav.innerHTML += `
      <button class="btn" id="nav-create-ad">➕ Déposer une annonce</button>
      <span style="font-weight:600; margin-left:10px;">👋 ${currentUser.username || "Utilisateur"}</span>
      <button class="btn secondary" id="nav-logout" style="color:var(--danger); margin-left:10px;">Quitter</button>
    `;
  } else {
    nav.innerHTML += `<button class="btn" id="nav-login">🔑 Connexion / Inscription</button>`;
  }
  bindNavEvents();
}

function bindNavEvents() {
  const loginBtn = document.getElementById("nav-login");
  if (loginBtn)
    loginBtn.onclick = () => {
      currentMode = "login";
      toggleAuthMode();
      showView("view-auth");
    };
  const logoutBtn = document.getElementById("nav-logout");
  if (logoutBtn) logoutBtn.onclick = logout;
  const createAdBtn = document.getElementById("nav-create-ad");
  if (createAdBtn) createAdBtn.onclick = () => showView("view-create-ad");
}

// --- RÉCUPÉRATION DES DONNÉES ---
async function loadCategories() {
  try {
    const res = await fetch(`${API_URL}/categories`, {
      credentials: "include",
    });
    const data = await res.json();
    // ... logique de chargement des catégories inchangée ...
  } catch (e) {
    console.error(e);
  }
}

async function loadAds() {
  try {
    const res = await fetch(`${API_URL}/ads`, { credentials: "include" });
    const data = await res.json();
    // ... logique de chargement des annonces inchangée ...
  } catch (e) {
    console.error(e);
  }
}

// --- CRÉATION D'ANNONCE ---
async function handleCreateAd(e) {
  e.preventDefault();

  if (!currentUser) {
    alert("❌ Vous devez être connecté pour publier une annonce !");
    return;
  }

  const adData = {
    title: document.getElementById("ad-title").value,
    category_id: document.getElementById("ad-category").value,
    price: document.getElementById("ad-price").value,
    city: document.getElementById("ad-city").value,
    description: document.getElementById("ad-description").value,
    image_url: document.getElementById("ad-image").value,
  };

  try {
    const res = await fetch(`${API_URL}/ads`, {
      method: "POST",
      credentials: "include", // ESSENTIEL : envoie le cookie de session
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adData),
    });

    if (res.status === 401)
      throw new Error(
        "Session invalide ou expirée, veuillez vous reconnecter.",
      );
    if (!res.ok) throw new Error("Erreur lors de la publication.");

    alert("🎉 Annonce publiée !");
    showView("view-home");
  } catch (err) {
    alert(`❌ Impossible de publier : ${err.message}`);
  }
}

// --- AUTHENTIFICATION ---
async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById("auth-email").value;
  const password = document.getElementById("auth-password").value;
  const username = document.getElementById("auth-username").value;

  const endpoint = currentMode === "login" ? "/auth/login" : "/auth/register";
  const body =
    currentMode === "login"
      ? { email, password }
      : { username, email, password };

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      credentials: "include", // ESSENTIEL : reçoit le cookie de session
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Erreur de connexion");

    currentUser = data.user || { email, username: email.split("@")[0] };
    localStorage.setItem("user", JSON.stringify(currentUser));

    alert("Bienvenue !");
    setupNavigation();
    showView("view-home");
  } catch (err) {
    alert(`❌ Erreur : ${err.message}`);
  }
}

function logout() {
  localStorage.clear();
  currentUser = null;
  fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
  setupNavigation();
  showView("view-home");
}

function setupEventListeners() {
  document.getElementById("auth-form").onsubmit = handleAuth;
  document.getElementById("form-create-ad").onsubmit = handleCreateAd;
  document.getElementById("btn-home").onclick = () => showView("view-home");
  document.getElementById("auth-toggle").onclick = (e) => {
    e.preventDefault();
    currentMode = currentMode === "login" ? "register" : "login";
    toggleAuthMode();
  };
}

function toggleAuthMode() {
  // ... logique du bascule de formulaire ...
}
