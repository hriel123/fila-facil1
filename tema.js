/* =========================================================
   FilaFácil — tema.js
   Alterna entre o tema escuro (padrão) e o claro e lembra a
   escolha no navegador. O <head> de cada página já aplica o
   tema salvo antes de desenhar a tela.
========================================================= */

(() => {
  "use strict";

  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');

  function apply(light) {
    if (light) root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    if (meta) meta.content = light ? "#f6f4ef" : "#0b0d0f";
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      b.setAttribute("aria-label", light ? "Usar tema escuro" : "Usar tema claro");
      b.title = light ? "Tema escuro" : "Tema claro";
    });
  }

  apply(root.getAttribute("data-theme") === "light");

  document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
    b.addEventListener("click", () => {
      const light = root.getAttribute("data-theme") !== "light";
      apply(light);
      try { localStorage.setItem("filafacil:tema", light ? "claro" : "escuro"); } catch { /* sem armazenamento */ }
    });
  });
})();
