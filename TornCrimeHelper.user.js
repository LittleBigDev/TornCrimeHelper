// ==UserScript==
// @name         TornCrimeHelper
// @namespace    wardogs.torncrimehelper
// @version      1.9
// @description  Aide aux crimes Torn. Bootlegging : genre de DVD à copier selon un ratio visé, Copy et Sell grisés quand ce n'est pas le moment. Graffiti : quartier et couleur à utiliser.
// @match        https://www.torn.com/page.php?sid=crimes*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// @downloadURL  https://raw.githubusercontent.com/LittleBigDev/TornCrimeHelper/main/TornCrimeHelper.user.js
// @updateURL    https://raw.githubusercontent.com/LittleBigDev/TornCrimeHelper/main/TornCrimeHelper.user.js
// ==/UserScript==

// Pages de crimes seulement (hub et crimes, routes en #/ d'une même page) : chaque crime aidé a sa section.

(function () {
  "use strict";

  // ---------- Bootlegging : genre de DVD à copier ----------
  // Historique de chaque Copy (genre, copies lancées, niveau) lu dans la réponse de Torn, moyenne par genre
  // et par niveau, puis conseil : genre à copier (présélectionné, cadre vert), vendre (cadre vert sur Sell)
  // ou attendre la fin des copies (Copy et Sell grisés). Stock d'un genre = en stock + en file d'attente.

  const GENRES = ["Action", "Comedy", "Drama", "Fantasy", "Horror", "Romance", "Thriller", "Sci-Fi"];  // id Torn = rang + 1
  // Ratio visé : celui des DVD vendus par genre (statistiques du crime, lues dans les réponses de Torn), dès qu'il
  // y en a assez ; avant, ratio communautaire fixe (plus petits entiers). Le stock minimal (seuilDvd) s'y adapte.
  const RATIO_FIXE = [54, 38, 30, 38, 16, 16, 22, 11];
  const VENTES_MIN = 2000;  // DVD vendus avant de passer au ratio réel (part d'un genre à ~5 % : ±0,5 point)
  const ratio = () => {
    const v = GM_getValue("bootleg_ventes", []);
    return v.length === 8 && v.reduce((a, b) => a + b, 0) >= VENTES_MIN ? v : RATIO_FIXE;
  };
  const TOLERANCE = 15;  // en % de la cible, en plus comme en moins
  const COPIES_DEFAUT = 15;  // tant qu'aucune copie n'est mémorisée
  const bootlegging = () => location.hash.includes("bootlegging");

  // Réponse d'un Copy (crimeID 8, genre dans value1) : « Copying 14 Action DVDs »
  function noterCopie(url, texte) {
    const u = new URL(url, location.href);
    if (u.searchParams.get("step") !== "attempt" || u.searchParams.get("crimeID") !== "8") return;
    const db = JSON.parse(texte).DB, s = db?.currentUserStats;
    const n = Number(/Copying (\d+)/.exec((db?.outcome?.rewards || []).map((r) => r.text).join(" "))?.[1]);
    if (db?.outcome?.result !== "success" || !n || !s) return;
    const h = GM_getValue("bootleg_copies", []);
    h.push({ t: Date.now(), g: Number(u.searchParams.get("value1")), n, niveau: s.skill + (s.skillLevel || 0) / 100 });
    GM_setValue("bootleg_copies", h);
  }

  // Toute réponse de Bootlegging : DVD vendus par genre depuis le début (CDType1Sold à CDType8Sold)
  function noterVentes(texte) {
    const s = JSON.parse(texte).DB?.currentUserStats;
    const v = GENRES.map((_, i) => Number(s?.[`CDType${i + 1}Sold`]));
    if (v.every((x) => Number.isFinite(x) && x >= 0)) GM_setValue("bootleg_ventes", v);
  }

  // Sécurité : un Copy ne part que sur le genre conseillé ou sur le dernier genre choisi à la main (clic réel,
  // pas la présélection du script). Des Copy sont déjà partis sur un autre genre que celui affiché, cause inconnue.
  let conseilGenre = null, choixManuel = null;  // id Torn (rang + 1)
  document.addEventListener("click", (e) => {
    const b = e.isTrusted && e.target.closest?.("button[class*=genreStock]");
    const i = b ? GENRES.indexOf(b.querySelector("[class*=genreName]")?.textContent.trim()) : -1;
    if (i >= 0) choixManuel = i + 1;
  }, true);

  function copieRefusee(url) {
    const u = new URL(url, location.href), g = Number(u.searchParams.get("value1"));
    if (u.searchParams.get("step") !== "attempt" || u.searchParams.get("crimeID") !== "8" || !(g >= 1 && g <= GENRES.length)) return null;
    const permis = [conseilGenre, choixManuel].filter((x) => x !== null);
    if (!permis.length || permis.includes(g)) return null;
    return `Copy bloqué : la requête demandait ${GENRES[g - 1]}, attendu ${permis.map((x) => GENRES[x - 1]).join(" ou ")}`;
  }

  function signalerBlocage(texte) {
    const p = document.getElementById("tch-dvd");
    if (!p) return;
    let a = p.querySelector(".o-bloque");
    if (!a) {
      a = document.createElement("div");
      a.className = "o-bloque";
      p.querySelector(".o-head").after(a);
    }
    a.textContent = texte;
    clearTimeout(signalerBlocage.minuteur);
    signalerBlocage.minuteur = setTimeout(() => a.remove(), 15000);
  }

  {  // espion des requêtes et réponses de Torn
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window, origine = page.fetch;
    const espion = function (...args) {
      const url = String(args[0]?.url || args[0]);
      const refus = copieRefusee(url);
      if (refus) {  // la requête ne part pas : ce clic ne fait aucune action
        signalerBlocage(refus);
        return Promise.reject(new Error("TornCrimeHelper : " + refus));
      }
      const p = origine.apply(this, args);
      if (url.includes("crimesData")) p.then((r) => r.clone().text()).then((t) => { noterVentes(t); noterCopie(url, t); }).catch(() => {});
      return p;
    };
    page.fetch = typeof exportFunction === "function" ? exportFunction(espion, page) : espion;
  }

  // Copies moyennes par clic pour un genre (id), au niveau entier actuel ; à défaut, ce genre aux niveaux
  // les plus proches, puis tous genres à ce niveau, puis tout l'historique
  function copiesParClic(g, niveau) {
    const h = GM_getValue("bootleg_copies", []), moy = (l) => l.reduce((s, x) => s + x.n, 0) / l.length;
    const auNiveau = (l) => l.filter((x) => Math.floor(x.niveau) === Math.floor(niveau));
    const genre = h.filter((x) => x.g === g);
    if (auNiveau(genre).length >= 3) return moy(auNiveau(genre));
    if (genre.length) return moy([...genre].sort((a, b) => Math.abs(a.niveau - niveau) - Math.abs(b.niveau - niveau)).slice(0, 5));
    if (auNiveau(h).length) return moy(auNiveau(h));
    return h.length ? moy(h) : COPIES_DEFAUT;
  }

  // Écart au ratio : somme des écarts de part de chaque genre
  function ecartRatio(stocks, ratio) {
    const total = stocks.reduce((a, b) => a + b, 0) || 1, r = ratio.reduce((a, b) => a + b, 0) || 1;
    return stocks.reduce((s, v, i) => s + Math.abs(v / total - ratio[i] / r), 0);
  }

  // Cible d'un genre : sa part du ratio appliquée à un stock total (en stock + en file). Écart acceptable : à moins
  // de TOLERANCE % de la cible, en plus comme en moins ; l'écart accepté grandit donc avec le stock total.
  function ecarts(stocks, total = stocks.reduce((a, b) => a + b, 0)) {
    const rt = ratio(), r = rt.reduce((a, b) => a + b, 0);
    return stocks.map((v, i) => {
      const cible = (rt[i] / r) * total;
      return { cible, ecart: v - cible, ok: Math.abs(v - cible) <= (cible * TOLERANCE) / 100 };
    });
  }

  // Stock total minimal : celui où une demi-copie (l'erreur d'arrondi d'un clic) tient dans la tolérance pour
  // chaque genre, le plus petit compris. Il suit les copies moyennes par clic, donc le niveau.
  function seuilDvd(copies) {
    const rt = ratio(), r = rt.reduce((a, b) => a + b, 0);
    return Math.max(...rt.map((x, i) => copies[i] / 2 / (TOLERANCE / 100) / (x / r)));
  }

  // Conseil : { copier: rang du genre } ou, quand rien n'est à copier, { vendre } (file vide) ou { attendre }.
  // Sous le stock minimal : copier le genre qui rapproche le plus du ratio. Au-dessus : copier seulement si un genre
  // sort de la tolérance et qu'une copie rapproche du ratio (pas de recherche sans fin du ratio parfait). Une copie
  // qui dépasse sa cible reste choisie si elle rapproche l'ensemble du ratio : les cibles montent avec le stock.
  function conseilDvd(stocks, enFile, copies) {
    const fin = enFile > 0 ? { attendre: true } : { vendre: true };
    const sous = stocks.reduce((a, b) => a + b, 0) < seuilDvd(copies);
    if (!sous && ecarts(stocks).every((x) => x.ok)) return fin;
    const rt = ratio();
    let meilleur = -1, ecart = sous ? Infinity : ecartRatio(stocks, rt);
    stocks.forEach((_, i) => {
      const e = ecartRatio(stocks.map((v, j) => (j === i ? v + copies[i] : v)), rt);
      if (e < ecart - 1e-9) { ecart = e; meilleur = i; }
    });
    return meilleur >= 0 ? { copier: meilleur } : fin;
  }

  // Plan : les copies conseillées, une par une, avec les copies moyennes par clic. Rend le stock final de
  // chaque genre ; total visé = sa somme, genre encore à copier = stock final au-dessus du stock actuel.
  function planDvd(stocks, copies) {
    const s = stocks.slice();
    for (let k = 0; k < 1000; k++) {  // ponytail: borne de sécurité, le conseil s'arrête bien avant (quelques dizaines)
      const c = conseilDvd(s, 0, copies);
      if (c.copier === undefined) break;
      s[c.copier] += copies[c.copier];
    }
    return s;
  }

  function lireGenres() {
    return [...document.querySelectorAll("button[class*=genreStock]")].map((b) => ({
      bouton: b,
      i: GENRES.indexOf(b.querySelector("[class*=genreName]")?.textContent.trim()),
      stock: parseInt(b.querySelector("[class*=currentStock]")?.textContent.replace(/\D/g, ""), 10) || 0,
      file: parseInt(b.querySelector("[class*=statusText]")?.textContent, 10) || 0,  // « 18 queued », « 1 copying »
      choisi: /selected/.test(b.className),
    })).filter((x) => x.i >= 0);
  }

  const VERT = "inset 0 0 0 3px #34d399";
  let dernierConseil = null;

  // Style repris du fork Torn Oracle (couleurs, en-tête, cartes, mode sombre de Torn)
  const STYLE_DVD = `
#tch-dvd { --o-bg:#fff; --o-bg-sunk:#f4f6f8; --o-bg-raise:#fff; --o-line:#dde3e9; --o-text:#10161c; --o-dim:#4a5763;
  --o-faint:#626f7c; --o-accent:#0d9488; --o-go:#047857; --o-go-soft:#d1fae5; --o-warn:#b45309; --o-warn-soft:#fef3c7;
  box-sizing:border-box; width:100%; margin:10px 0; border:1px solid var(--o-line); border-radius:10px;
  background:var(--o-bg); color:var(--o-text); font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; overflow:hidden; }
#tch-dvd.o-dark { --o-bg:#171d24; --o-bg-sunk:#10151b; --o-bg-raise:#1e262f; --o-line:#2c3742; --o-text:#e7edf3; --o-dim:#b3c0cd;
  --o-faint:#97a5b3; --o-accent:#2dd4bf; --o-go:#34d399; --o-go-soft:#064e3b; --o-warn:#fbbf24; --o-warn-soft:#451a03; }
#tch-dvd *, #tch-dvd *::before, #tch-dvd *::after { box-sizing:inherit; font-family:inherit; }
#tch-dvd .o-head { display:flex; align-items:center; gap:8px; padding:8px 10px; background:var(--o-bg-raise); border-bottom:1px solid var(--o-line); }
#tch-dvd .o-brand { font-weight:700; letter-spacing:.02em; color:var(--o-accent); flex:0 0 auto; }
#tch-dvd .o-dot { width:8px; height:8px; border-radius:50%; background:var(--o-go); flex:0 0 auto; }
#tch-dvd .o-dot.is-warn { background:var(--o-warn); }
#tch-dvd .o-head-line { flex:1 1 auto; min-width:0; font-weight:600; color:var(--o-text); }
#tch-dvd .o-body { display:grid; grid-template-columns:repeat(auto-fit,minmax(82px,1fr)); gap:6px; padding:8px 10px; background:var(--o-bg-sunk); }
#tch-dvd .o-card { display:flex; flex-direction:column; align-items:center; gap:4px; padding:6px 4px; border:1px solid var(--o-line);
  border-radius:8px; background:var(--o-bg); color:var(--o-dim); font-size:12px; }
#tch-dvd .o-cible { font-size:16px; font-weight:700; color:var(--o-text); }
#tch-dvd .o-ecart { min-width:44px; padding:1px 8px; border-radius:999px; text-align:center; font-weight:700;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--o-go); background:var(--o-go-soft); }
#tch-dvd .o-ecart.is-warn { color:var(--o-warn); background:var(--o-warn-soft); }
#tch-dvd .o-bloque { padding:6px 10px; background:#7f1d1d; color:#fecaca; font-weight:700; }
#tch-dvd .o-btn, #tch-dvd .o-save button { flex:0 0 auto; padding:2px 8px; border:1px solid var(--o-line); border-radius:6px;
  background:var(--o-bg); color:var(--o-dim); font-size:12px; cursor:pointer; }
#tch-dvd .o-save { display:flex; flex-direction:column; gap:6px; padding:8px 10px; border-top:1px solid var(--o-line); }
#tch-dvd .o-save[hidden] { display:none; }
#tch-dvd .o-save-btns { display:flex; flex-wrap:wrap; gap:6px; }
#tch-dvd .o-save textarea { width:100%; font:11px ui-monospace,Consolas,monospace; background:var(--o-bg-sunk); color:var(--o-text);
  border:1px solid var(--o-line); border-radius:6px; }
#tch-dvd .o-save-bilan { color:var(--o-warn); font-weight:600; }
#tch-dvd-attente { align-self:center; flex:0 0 auto; margin:0 10px; padding:3px 10px; border-radius:999px; white-space:nowrap;
  background:#451a03; color:#fbbf24; font:600 12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }`;

  function panneauDvd(cible) {
    let p = document.getElementById("tch-dvd");
    if (p) return p;
    if (!document.getElementById("tch-dvd-style")) {
      const s = document.createElement("style");
      s.id = "tch-dvd-style";
      s.textContent = STYLE_DVD;
      document.head.append(s);
    }
    p = document.createElement("div");
    p.id = "tch-dvd";
    p.innerHTML = '<div class="o-head"><span class="o-dot"></span><span class="o-brand">TornCrimeHelper</span>'
      + '<span class="o-head-line" id="tch-dvd-conseil"></span>'
      + '<button class="o-btn o-save-ouvrir" title="Exporter ou importer l&#39;historique des copies">Sauvegarde</button></div><div class="o-body">'
      + GENRES.map((g, i) => `<div class="o-card">${g}<span class="o-cible" data-i="${i}" `
        + `title="Cible : nombre de DVD visé (stock + file)"></span><span class="o-ecart" data-i="${i}" `
        + `title="Écart à la cible (vert : à moins de ${TOLERANCE} %)"></span></div>`).join("")
      + "</div>";
    zoneSauvegarde(p);
    cible.before(p);
    return p;
  }

  // Écrit seulement si ça change : une réécriture à l'identique relancerait l'observateur, donc majDvd, en boucle
  const ecrire = (el, texte) => { if (el.textContent !== texte) el.textContent = texte; };

  function majDvd() {
    // boutons repérés par leur aria-label (« Copy, 2 nerve ») : en mode mobile, le texte n'est plus que le coût en
    // nerve ; à défaut, par leur texte (« Copy2 », « Sell5 »)
    const boutons = [...document.querySelectorAll("button[class*=commitButton]")];
    const nom = (b) => b.getAttribute("aria-label") || b.textContent.trim();
    const copy = boutons.find((b) => /^copy/i.test(nom(b)));
    const sell = boutons.find((b) => /^sell/i.test(nom(b)));
    const genres = lireGenres(), zone = document.querySelector("[class*=currentCrime]");
    if (genres.length !== GENRES.length || !zone) return;
    const p = panneauDvd(zone);
    p.classList.toggle("o-dark", document.body.classList.contains("dark-mode"));
    const stocks = Array(GENRES.length).fill(0);
    genres.forEach((x) => { stocks[x.i] = x.stock + x.file; });
    const enFile = genres.reduce((s, x) => s + x.file, 0);
    const niveau = parseFloat(document.querySelector('[aria-label^="Skill: "]')?.getAttribute("aria-label").slice(7)) || 0;
    const copies = GENRES.map((_, i) => copiesParClic(i + 1, niveau));
    const c = conseilDvd(stocks, enFile, copies);

    // cibles affichées : le ratio appliqué au stock total où mèneront les copies conseillées
    const plan = planDvd(stocks, copies), e = ecarts(stocks, plan.reduce((a, b) => a + b, 0));
    // orange : hors tolérance, ou encore des copies prévues pour ce genre avant la cible globale
    const aCopier = (i) => !e[i].ok || plan[i] > stocks[i];
    p.querySelectorAll(".o-cible").forEach((x) => ecrire(x, String(Math.round(e[Number(x.dataset.i)].cible))));
    p.querySelectorAll(".o-ecart").forEach((s) => {
      const x = e[Number(s.dataset.i)], n = Math.round(x.ecart);
      ecrire(s, n > 0 ? `+${n}` : String(n));
      s.classList.toggle("is-warn", aCopier(Number(s.dataset.i)));
    });
    p.querySelector(".o-dot").classList.toggle("is-warn", stocks.some((_, i) => aCopier(i)));

    genres.forEach((x) => x.bouton.style.setProperty("box-shadow", c.copier === x.i ? VERT : "", "important"));
    sell?.style.setProperty("box-shadow", c.vendre ? VERT : "", "important");
    // Désactivation native (attribut disabled, comme Torn faute de nerve), avec la raison en info-bulle sur la case
    // du bouton (un bouton désactivé ne reçoit plus le survol). Un bouton désactivé par Torn n'est jamais réactivé.
    const bloquer = (b, raison) => {
      if (!b) return;
      const caseBouton = b.parentElement;
      if (raison) {
        if (!b.disabled) { b.disabled = true; b.dataset.tchBloque = "1"; }
        if (b.dataset.tchBloque) { b.style.pointerEvents = "none"; caseBouton.dataset.tchBulle = raison; }
      } else if (b.dataset.tchBloque) {
        b.disabled = false;
        b.style.pointerEvents = "";
        delete b.dataset.tchBloque;
        delete caseBouton.dataset.tchBulle;
      }
    };
    bloquer(copy, c.copier !== undefined ? "" : c.vendre ? "Bon ratio : rien à copier, vendre" : "Bon ratio : rien à copier, attendre la fin des copies");
    bloquer(sell, c.vendre ? "" : c.attendre ? "Attendre la fin des copies avant de vendre" : `Copies à faire avant de vendre (copier ${GENRES[c.copier]})`);
    // DVD vierges déballés (« Add: Blank DVDs, 2530 DVDs unpacked ») : sous un clic de copies, Torn grise tout
    // sans dire pourquoi ; liseré rouge sur le bouton d'ajout
    const vierges = document.querySelector('button[aria-label^="Add: Blank DVDs"]');
    const nVierges = Number(/([\d,]+) DVDs unpacked/.exec(vierges?.getAttribute("aria-label"))?.[1].replace(/,/g, "") || 0);
    cadrer(vierges, nVierges < Math.max(...copies) ? TRAIT_ROUGE : "", `Ajouter des DVD vierges (${nVierges} déballés)`);
    let attente = document.getElementById("tch-dvd-attente");
    if (c.attendre && !attente && sell) {
      attente = document.createElement("span");
      attente.id = "tch-dvd-attente";
      attente.textContent = "Attendre la fin des copies";
      // avant la case du bouton (trop étroite pour le message), dans la ligne du crime
      (sell.closest("[class*=crimeOptionSection]") || sell).before(attente);
    } else if (!c.attendre) attente?.remove();
    ecrire(p.querySelector("#tch-dvd-conseil"), (c.copier !== undefined
      ? `Copier ${GENRES[c.copier]} (~${Math.round(copies[c.copier])} par clic)`
      : c.vendre ? "Bon ratio : vendre" : "Bon ratio : attendre la fin des copies, puis vendre")
      + ` · stock ${stocks.reduce((x, y) => x + y, 0)}, minimum ${Math.ceil(seuilDvd(copies))}`);

    // présélection du genre conseillé, seulement quand le conseil change (un choix à la main est respecté)
    conseilGenre = c.copier !== undefined ? c.copier + 1 : null;
    const cle = JSON.stringify(c);
    if (cle !== dernierConseil) {
      dernierConseil = cle;
      choixManuel = null;  // nouveau conseil, présélectionné : un ancien choix à la main ne vaut plus
      const g = genres.find((x) => x.i === c.copier);
      if (g && !g.choisi) g.bouton.click();  // simple choix d'affichage, aucune requête au serveur
    }
  }

  // ---------- Bootlegging : export et import de l'apprentissage ----------
  // Ce qui affine les conseils : l'historique des Copy (bootleg_copies). Export en JSON, avec pour information les
  // moyennes qu'on en tire et les réglages fixes (ratio, tolérance) ; seul l'historique est réimporté.
  // Import : fusion avec l'historique existant ; une copie est identifiée par son heure, donc pas de doublon.
  // Dans le bloc Bootlegging, sans menu d'extension (Torn PDA n'en a pas) : fichier, ou texte à copier-coller
  // si le navigateur bloque le téléchargement ou le choix de fichier.

  // Moyenne de copies par clic, par genre et par niveau entier : { Action: { "62": { clics, moyenne } } }
  function moyennesDvd(h) {
    const m = {};
    h.forEach((x) => {
      const c = ((m[GENRES[x.g - 1]] ??= {})[Math.floor(x.niveau)] ??= { clics: 0, total: 0 });
      c.clics++;
      c.total += x.n;
    });
    Object.values(m).forEach((g) => Object.values(g).forEach((c) => {
      c.moyenne = Math.round((c.total / c.clics) * 10) / 10;
      delete c.total;
    }));
    return m;
  }

  function exportDvd() {
    const copies = GM_getValue("bootleg_copies", []);
    return JSON.stringify({
      script: "TornCrimeHelper", partie: "bootlegging", date: new Date().toISOString(),
      reglages: { genres: GENRES, ratio: ratio(), tolerance: TOLERANCE },
      moyennes: moyennesDvd(copies),
      copies,
    }, null, 1);
  }

  function importDvd(texte) {
    const copies = JSON.parse(texte)?.copies;
    const valide = (x) => [x?.t, x?.g, x?.n, x?.niveau].every(Number.isFinite) && x.g >= 1 && x.g <= GENRES.length;
    if (!Array.isArray(copies) || !copies.every(valide)) throw new Error("données non reconnues");
    const avant = GM_getValue("bootleg_copies", []);
    const apres = [...new Map([...avant, ...copies].map((x) => [x.t, { t: x.t, g: x.g, n: x.n, niveau: x.niveau }])).values()]
      .sort((x, y) => x.t - y.t);
    GM_setValue("bootleg_copies", apres);
    return `${apres.length - avant.length} copies ajoutées (${apres.length} en tout)`;
  }

  // Zone repliée sous les cartes, ouverte par le bouton « Sauvegarde » de l'en-tête
  function zoneSauvegarde(p) {
    const z = document.createElement("div");
    z.className = "o-save";
    z.hidden = true;
    z.innerHTML = '<div class="o-save-btns"><button data-a="fichier">Exporter (fichier)</button>'
      + '<button data-a="copier">Exporter (copier le texte)</button>'
      + '<label class="o-btn">Importer un fichier<input type="file" accept=".json,application/json,text/plain" hidden></label>'
      + '<button data-a="coller">Importer le texte collé</button></div>'
      + '<textarea rows="4" placeholder="Texte exporté, à copier ou à coller ici"></textarea><span class="o-save-bilan"></span>';
    const zone = z.querySelector("textarea"), bilan = z.querySelector(".o-save-bilan");
    const dire = (t) => { bilan.textContent = t; };
    const importer = (texte) => { try { dire(importDvd(texte)); } catch (e) { dire(`Échec : ${e.message}`); } };
    z.querySelector('[data-a="fichier"]').onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([exportDvd()], { type: "application/json" }));
      a.download = `bootlegging-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      dire("Fichier téléchargé (sinon : Exporter, copier le texte)");
    };
    z.querySelector('[data-a="copier"]').onclick = () => {
      zone.value = exportDvd();
      zone.select();
      // presse-papiers indisponible (page non sécurisée, webview) : le texte reste sélectionné, à copier à la main
      navigator.clipboard?.writeText(zone.value).then(() => dire("Copié dans le presse-papiers"), () => dire("Texte sélectionné : le copier"))
        ?? dire("Texte sélectionné : le copier");
    };
    z.querySelector('[data-a="coller"]').onclick = () => importer(zone.value);
    z.querySelector("input").onchange = (e) => e.target.files[0]?.text().then(importer);
    p.querySelector(".o-save-ouvrir").onclick = () => { z.hidden = !z.hidden; };
    p.append(z);
  }

  // ---------- Graffiti : quartier et couleur ----------
  // Sur la ligne du quartier conseillé seulement : cadre autour du choix de la bombe (vert : bonne couleur, rouge :
  // à changer) et cadre vert autour de Spray, chacun avec son info-bulle. Rien d'autre n'est affiché.
  // Source : guide « [Crimes 2.0] Graffiti: An In-Depth Guide » (forum Torn, données de 2023, couleurs peu sûres).

  // Ordre de la page ; échec moyen en %, couleurs qui semblent les meilleures pour l'argent et la réputation
  const QUARTIERS = {
    "East Side": { echec: 2.31, argent: "Purple", rep: "Red" },
    "West Side": { echec: 2.25, argent: "Green", rep: "Blue" },
    "North Side": { echec: 2.37, argent: "Green", rep: "Orange" },
    "Residential District": { echec: 0.92, argent: "White", rep: "Blue" },
    "Red-Light District": { echec: 3.16, argent: "Green", rep: "Pink" },
    "Financial District": { echec: 2.87, argent: "Black", rep: "Red" },
    "City Center": { echec: 2.27, argent: "Green", rep: "Blue" },
  };
  // Outils trouvés en issue unique, à aller chercher dès le niveau atteint : ils débloquent des issues en plus
  // (souvent mieux payées) dans tous les quartiers et semblent éviter des échecs critiques (guide, wiki, Torning)
  const OUTILS = [
    { nom: "West Side", niveau: 15, quoi: "Ladder" },
    { nom: "North Side", niveau: 25, quoi: "Wire Cutters" },
    { nom: "East Side", niveau: 35, quoi: "Paint Mask" },
  ];
  // Issues uniques d'accès à un quartier, au niveau 50, qui comptent parmi les étoiles de ces quartiers
  const ACCES = { "East Side": "Residential District", "West Side": "Red-Light District" };
  const COULEURS = { Black: "noir", Blue: "bleu", Brown: "marron", Green: "vert", Orange: "orange", Pink: "rose",
    Purple: "violet", Red: "rouge", White: "blanc", Yellow: "jaune" };
  const graffiti = () => location.hash.includes("graffiti");

  // Un outil manque à coup sûr quand le quartier montre plus d'issues uniques que toutes les autres possibles :
  // une par palier de réputation atteint (deux à R5 : crew et niveau 100), plus l'accès d'un quartier au niveau 50.
  // Sinon on ne sait pas (l'étoile peut être une autre issue) : pas de détour.
  function outilManquant(q, niveau) {
    const autres = q.rep + (q.rep >= 5 ? 1 : 0) + (ACCES[q.nom] && niveau >= 50 ? 1 : 0);
    return q.uniques > autres;
  }

  // Quartiers : [{ nom, rep (étoiles 0-5), verrouille, uniques (issues uniques à trouver) }] ; niveau : skill Graffiti ;
  // masque : Paint Mask possédé. Rend { nom, couleur, pourquoi } ou null. Ordre : issue unique du crew, outils,
  // accès à Residential, quartier le plus sûr. Red-Light (le plus risqué) et les autres issues uniques : pas de détour.
  function conseilGraffiti(quartiers, niveau, masque) {
    const ouverts = quartiers.filter((q) => !q.verrouille && QUARTIERS[q.nom]);
    const de = (nom) => ouverts.find((q) => q.nom === nom);
    const couleur = (q) => (q.rep < 5 ? QUARTIERS[q.nom].rep : QUARTIERS[q.nom].argent);
    const conseil = (q, pourquoi) => ({ nom: q.nom, couleur: couleur(q), pourquoi });
    const sansCrew = quartiers.some((q) => q.nom === "Financial District" && q.verrouille);
    const crew = niveau >= 70 && sansCrew && ouverts.find((q) => q.rep >= 5 && q.uniques > 0 && !/Financial|City/.test(q.nom));
    if (crew) return conseil(crew, "issue unique du crew (R5 et niveau 70)");
    const outil = OUTILS.find((o) => niveau >= o.niveau && de(o.nom)
      && (o.quoi === "Paint Mask" ? !masque && de(o.nom).uniques > 0 : outilManquant(de(o.nom), niveau)));
    if (outil) return conseil(de(outil.nom), `issue unique à trouver : ${outil.quoi}`);
    const residential = quartiers.find((q) => q.nom === "Residential District");
    if (niveau >= 50 && residential?.verrouille && de("East Side")?.uniques > 0) {
      return conseil(de("East Side"), "issue unique à trouver : accès à Residential");
    }
    const sur = [...ouverts].sort((a, b) => QUARTIERS[a.nom].echec - QUARTIERS[b.nom].echec)[0];
    return sur ? conseil(sur, `quartier le plus sûr (${String(QUARTIERS[sur.nom].echec).replace(".", ",")} % d'échec)`) : null;
  }

  // Nom du quartier : premier texte de la case. En mode mobile, il est dans un bloc avec le nombre de tags et
  // abrégé (« Residential », « Red-Light », « Financial ») : ramené au nom complet
  function nomQuartier(caseNom) {
    const w = caseNom && document.createTreeWalker(caseNom, NodeFilter.SHOW_TEXT);
    let n, t = "";
    while (w && !t && (n = w.nextNode())) t = n.textContent.trim();
    return t && (Object.keys(QUARTIERS).find((k) => k.startsWith(t)) || t);
  }

  function lireQuartiers() {
    return [...document.querySelectorAll("[class*=crimeOptionWrapper]")].map((r) => ({
      ligne: r,
      nom: nomQuartier(r.querySelector("[class*=crimeOptionSection][class*=flexGrow]")),
      rep: Number(/Reputation (\d)/.exec(r.querySelector("[class*=reputationIconWrapper]")?.getAttribute("aria-label"))?.[1] || 0),
      verrouille: /locked/.test(r.querySelector("[class*=crimeOption]")?.className),
      // étoiles sous Spray, une par issue unique disponible ; l'étiquette du bouton les compte aussi, mais Torn la
      // remplace faute de nerve (bouton grisé), alors que les étoiles restent
      uniques: r.querySelectorAll('[class*="uniqueStar___"]').length,
    }));
  }

  // Liseré autour d'un bouton (outline : un cadre intérieur serait caché par l'image de la bombe) et info-bulle,
  // posés ou retirés ; écrits seulement s'ils changent. Marque data-tch-cadre pour retrouver ce qu'on a posé.
  const TRAIT_VERT = "2px solid #34d399", TRAIT_ROUGE = "2px solid #f87171", TRAIT_POINTILLE = "2px dashed #34d399";
  function cadrer(b, trait, texte) {
    if (!b) return;
    if (trait) {
      if (b.dataset.tchCadre !== trait) {
        b.style.setProperty("outline", trait, "important");
        b.style.setProperty("outline-offset", "2px", "important");
        b.style.setProperty("border-radius", "6px");
        b.dataset.tchCadre = trait;
      }
      if (b.dataset.tchBulle !== texte) b.dataset.tchBulle = texte;
    } else if (b.dataset.tchCadre) {
      ["outline", "outline-offset", "border-radius"].forEach((x) => b.style.removeProperty(x));
      delete b.dataset.tchCadre;
      delete b.dataset.tchBulle;
    }
  }

  // Le sélecteur de bombes est commun à toutes les lignes : on retient de quelle ligne il a été ouvert
  let bombeOuverte = null;
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("button[class*=sprayCanButton]");
    if (b) bombeOuverte = b;
  }, true);

  function majGraffiti() {
    const quartiers = lireQuartiers();
    if (!quartiers.length) return;
    const niveau = parseFloat(document.querySelector('[aria-label^="Skill: "]')?.getAttribute("aria-label").slice(7)) || 0;
    const masque = !!document.querySelector('[aria-label="Enhancer: Paint Mask, owned"]');
    const c = conseilGraffiti(quartiers, niveau, masque);
    let cible = null, dejaBonne = false;
    quartiers.forEach((q) => {
      const bombe = q.ligne.querySelector("button[class*=sprayCanButton]");
      const spray = q.ligne.querySelector("button[class*=commitButton]");
      if (!c || q.nom !== c.nom) { cadrer(bombe, ""); cadrer(spray, ""); return; }
      cible = bombe;
      const voulue = COULEURS[c.couleur] || c.couleur, but = q.rep < 5 ? `réputation, R${q.rep} → R5` : "argent, R5 atteint";
      const actuelle = /^(\w+) spray selected/.exec(bombe?.getAttribute("aria-label") || "")?.[1];
      dejaBonne = actuelle === c.couleur;
      cadrer(bombe, actuelle === c.couleur ? TRAIT_VERT : TRAIT_ROUGE, actuelle === c.couleur
        ? `Bonne couleur : ${voulue} (${but})`
        : `Choisir ${voulue} (${but}) ; pas de bombe ${voulue} : Print Store`);
      cadrer(spray, TRAIT_VERT, `Spray ici : ${c.pourquoi}`);
    });
    // sélecteur ouvert depuis la ligne conseillée : pointillés verts sur la bonne bombe (absente si on n'en a pas),
    // sauf si elle est déjà choisie (Torn la marque déjà)
    const choix = document.querySelector("[class*=popover]"), ok = choix && cible && bombeOuverte === cible && !dejaBonne;
    const bonne = ok ? choix.querySelector(`button[aria-label="${c.couleur} spray paint"]`) : null;
    document.querySelectorAll("[class*=popover] button[data-tch-cadre]").forEach((b) => { if (b !== bonne) cadrer(b, ""); });
    cadrer(bonne, TRAIT_POINTILLE, `Couleur conseillée : ${COULEURS[c?.couleur] || ""}`);
  }

  // Une seule bulle flottante pour toute la page : les lignes de Torn coupent ce qui dépasse (overflow hidden)
  const infobulle = document.createElement("div");
  infobulle.style.cssText = "position:fixed;display:none;background:#1b1f26;color:#eee;padding:6px 10px;border-radius:5px;"
    + "border:1px solid #e0a030;box-shadow:0 3px 10px rgba(0,0,0,.7);font-size:12px;font-weight:bold;"
    + "white-space:nowrap;z-index:100000;pointer-events:none";
  document.body.append(infobulle);
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.("[data-tch-bulle]");
    if (!el) { infobulle.style.display = "none"; return; }
    infobulle.textContent = el.dataset.tchBulle;
    infobulle.style.display = "block";
    const r = el.getBoundingClientRect();
    infobulle.style.left = `${Math.max(4, r.right - infobulle.offsetWidth)}px`;
    infobulle.style.top = `${r.bottom + 6}px`;  // dessous : Torn met ses propres bulles au-dessus
  });


  // La page redessine ses éléments (changement de crime, file d'attente) : remettre l'aide, au plus une fois par image
  let prevu = false;
  function surveiller() {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => {
      prevu = false;
      if (bootlegging()) majDvd();
      if (graffiti()) majGraffiti();
    });
  }
  // characterData : Torn change certains textes en place (« 17 queued » → « 50 queued ») sans recréer d'élément
  // aria-label : la bombe choisie change l'étiquette du bouton (« Blue spray selected ») ; le script n'y écrit jamais
  new MutationObserver(surveiller).observe(document.body,
    { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
  surveiller();
})();
