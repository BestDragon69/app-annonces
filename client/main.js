const API_URL = "http://localhost:3001/api";
let currentUser = JSON.parse(localStorage.getItem("user")) || null;
let token = localStorage.getItem("token") || null;

if (token === "undefined" || token === "null") {
  token = null;
}

let selectedCategoryFilter = "";
let currentMode = "login";

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
  if (loginBtn) {
    loginBtn.onclick = () => {
      currentMode = "login";
      toggleAuthMode();
      showView("view-auth");
    };
  }

  const logoutBtn = document.getElementById("nav-logout");
  if (logoutBtn) logoutBtn.onclick = logout;

  const createAdBtn = document.getElementById("nav-create-ad");
  if (createAdBtn) createAdBtn.onclick = () => showView("view-create-ad");
}

// --- PARSING SÉCURISÉ ---
async function safeParseJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("Le serveur a renvoyé ceci au lieu d'un JSON :", text);
    return { error: `Réponse serveur illisible (Statut: ${res.status})` };
  }
}

// --- RÉCUPÉRATION DES CATÉGORIES ---
async function loadCategories() {
  try {
    const res = await fetch(`${API_URL}/categories`, {
      credentials: "include",
    });
    const data = await safeParseJson(res);

    let categories = [];
    if (Array.isArray(data)) categories = data;
    else if (typeof data === "object" && data !== null) {
      for (const key in data) {
        if (Array.isArray(data[key])) {
          categories = data[key];
          break;
        }
      }
    }

    const selectSearch = document.getElementById("search-category");
    const selectCreate = document.getElementById("ad-category");
    const quickLinks = document.getElementById("categories-quick-links");

    if (selectSearch)
      selectSearch.innerHTML =
        '<option value="">Toutes les catégories</option>';
    if (selectCreate) selectCreate.innerHTML = "";
    if (quickLinks) quickLinks.innerHTML = "";

    categories.forEach((cat) => {
      const opt = `<option value="${cat.id}">${cat.name}</option>`;
      if (selectSearch) selectSearch.innerHTML += opt;
      if (selectCreate) selectCreate.innerHTML += opt;

      if (quickLinks) {
        const chip = document.createElement("div");
        chip.className = "category-chip";
        chip.textContent = cat.name;
        chip.onclick = () => {
          document
            .querySelectorAll(".category-chip")
            .forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
          selectedCategoryFilter = cat.id;
          loadAds();
        };
        quickLinks.appendChild(chip);
      }
    });
  } catch (e) {
    console.error("Erreur catégories:", e);
  }
}

// --- RÉCUPÉRATION DES ANNONCES ---
// --- RÉCUPÉRATION DES ANNONCES ---
async function loadAds() {
  const q = document.getElementById("search-q").value;
  const category =
    selectedCategoryFilter || document.getElementById("search-category").value;
  const city = document.getElementById("search-city").value;
  const priceMax = document.getElementById("search-price-max").value;

  // On construit une URL ultra-propre
  const params = new URLSearchParams();
  if (q) params.append("q", q);
  if (category) params.append("category", category);
  if (city) params.append("city", city);
  if (priceMax) params.append("priceMax", priceMax);

  const url = `${API_URL}/ads?${params.toString()}`;

  try {
    // 🔥 LA FEINTE DE NINJA EST ICI 🔥
    // En retirant `credentials: "include"`, on interroge le backend en tant qu'anonyme.
    // Il n'aura pas ton UUID, et ne fera donc pas planter sa propre requête SQL !
    const res = await fetch(url);
    const data = await safeParseJson(res);

    let ads = [];
    if (Array.isArray(data)) {
      ads = data;
    } else if (typeof data === "object" && data !== null) {
      for (const key in data) {
        if (Array.isArray(data[key])) {
          ads = data[key];
          break;
        }
      }
    }

    const container = document.getElementById("ads-container");
    if (!container) return;
    container.innerHTML = "";

    if (!Array.isArray(ads) || ads.length === 0) {
      container.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:40px;">
            <p style="color:#64748b; font-size: 1.1rem; margin-bottom: 10px;">Aucune annonce trouvée.</p>
        </div>`;
      return;
    }

    ads.forEach((ad) => {
      const imgUrl =
        ad.image_url ||
        fallbackImages[ad.category_name] ||
        "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500";
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <img class="card-img" src="${imgUrl}" alt="Annonce">
        <div class="card-body">
          <div class="card-price">${ad.price} €</div>
          <div class="card-title">${ad.title}</div>
          <div class="card-meta">📍 ${ad.city || "France"} | 📂 ${ad.category_name || "Général"}</div>
          <button class="btn secondary view-btn" style="margin-top:12px; width:100%">🔍 Voir le descriptif</button>
        </div>
      `;
      card.querySelector(".view-btn").onclick = () => {
        alert(
          `📢 ${ad.title}\n\n💰 Prix : ${ad.price} €\n📍 Ville : ${ad.city}\n\n📝 Description :\n${ad.description}`,
        );
      };
      container.appendChild(card);
    });
  } catch (err) {
    const container = document.getElementById("ads-container");
    if (container)
      container.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--danger);">Erreur de chargement des données : ${err.message}</p>`;
  }
}

// --- LOGIQUE DE CRÉATION DE L'ANNONCE ---
async function handleCreateAd(e) {
  e.preventDefault();

  if (!currentUser) {
    alert("❌ Vous devez être connecté pour publier une annonce !");
    showView("view-auth");
    return;
  }

  const title = document.getElementById("ad-title").value.trim();
  const categorySelect = document.getElementById("ad-category");
  const categoryIdRaw = categorySelect ? categorySelect.value : "";
  const price = Number(document.getElementById("ad-price").value);
  const city = document.getElementById("ad-city").value.trim();
  const description = document.getElementById("ad-description").value.trim();
  const imageUrl = document.getElementById("ad-image").value.trim();

  if (!title || !categoryIdRaw || isNaN(price) || !city || !description) {
    alert("❌ Veuillez remplir tous les champs obligatoires.");
    return;
  }

  const bodyData = {
    title: title,
    category_id: isNaN(Number(categoryIdRaw))
      ? categoryIdRaw
      : Number(categoryIdRaw),
    price: price,
    city: city,
    description: description,
  };

  if (imageUrl) {
    bodyData.image_url = imageUrl;
  }

  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API_URL}/ads`, {
      method: "POST",
      credentials: "include",
      headers: headers,
      body: JSON.stringify(bodyData),
    });

    const data = await safeParseJson(res);

    if (!res.ok) {
      let backendError = data.message || data.error;
      if (!backendError && data.errors)
        backendError = JSON.stringify(data.errors);
      if (!backendError && Object.keys(data).length > 0)
        backendError = JSON.stringify(data);
      throw new Error(backendError || `Code ${res.status}`);
    }

    alert("🎉 Votre annonce a bien été publiée !");
    document.getElementById("form-create-ad").reset();
    showView("view-home");
    loadAds();
  } catch (err) {
    alert(`❌ Impossible de publier : ${err.message}`);
    if (
      err.message.includes("authentifié") ||
      err.message.includes("Session") ||
      err.message.includes("401")
    ) {
      logout();
    }
  }
}

function findTokenInResponse(data) {
  if (data.token) return data.token;
  if (data.accessToken) return data.accessToken;
  if (data.access_token) return data.access_token;
  if (data.jwt) return data.jwt;
  if (data.data) {
    if (data.data.token) return data.data.token;
    if (data.data.accessToken) return data.data.accessToken;
    if (data.data.access_token) return data.data.access_token;
  }
  return null;
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
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await safeParseJson(res);

    if (!res.ok) {
      throw new Error(
        data.message || data.error || `Erreur serveur ${res.status}`,
      );
    }

    if (currentMode === "login") {
      token = findTokenInResponse(data);
      currentUser = data.user ||
        data.data?.user || { email, username: email.split("@")[0] };

      if (token) localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(currentUser));

      alert(`Bienvenue ${currentUser.username || ""} !`);

      setupNavigation();
      showView("view-home");
      loadAds();
    } else {
      alert(
        "Inscription réussie ! Connectez-vous avec vos nouveaux identifiants.",
      );
      currentMode = "login";
      toggleAuthMode();
    }
  } catch (err) {
    alert(`❌ Erreur : ${err.message}`);
  }
}

function toggleAuthMode() {
  const regFields = document.querySelectorAll(".id-register-only");
  const title = document.getElementById("auth-title");
  const btn = document.getElementById("auth-submit-btn");
  const toggleLink = document.getElementById("auth-toggle");

  if (currentMode === "login") {
    if (title) title.textContent = "Connexion";
    if (btn) btn.textContent = "Se connecter";
    if (toggleLink) toggleLink.textContent = "Pas de compte ? S'inscrire";
    regFields.forEach((f) => f.classList.add("hidden"));
    document.getElementById("auth-username").removeAttribute("required");
  } else {
    if (title) title.textContent = "Créer un compte";
    if (btn) btn.textContent = "S'inscrire";
    if (toggleLink) toggleLink.textContent = "Déjà inscrit ? Se connecter";
    regFields.forEach((f) => f.classList.remove("hidden"));
    document.getElementById("auth-username").setAttribute("required", "true");
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.clear();

  fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});

  setupNavigation();
  showView("view-home");
  loadAds();
}

// --- ÉCOUTEURS D'ÉVÉNEMENTS ---
function setupEventListeners() {
  document.getElementById("btn-home").onclick = () => {
    selectedCategoryFilter = "";
    document
      .querySelectorAll(".category-chip")
      .forEach((c) => c.classList.remove("active"));
    document.getElementById("search-q").value = "";
    document.getElementById("search-city").value = "";
    document.getElementById("search-price-max").value = "";
    showView("view-home");
    loadAds();
  };

  document.getElementById("btn-search").onclick = loadAds;
  document.getElementById("btn-reset-filters").onclick = () =>
    document.getElementById("btn-home").click();

  const authForm = document.getElementById("auth-form");
  if (authForm) authForm.onsubmit = handleAuth;

  const adForm = document.getElementById("form-create-ad");
  if (adForm) adForm.onsubmit = handleCreateAd;

  const authToggle = document.getElementById("auth-toggle");
  if (authToggle) {
    authToggle.onclick = (e) => {
      e.preventDefault();
      currentMode = currentMode === "login" ? "register" : "login";
      toggleAuthMode();
    };
  }
}
