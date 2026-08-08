const ROUTES = new Set(["home", "create", "battle", "result"]);

export function routeFromHash(hash = window.location.hash) {
  const route = hash.replace(/^#/, "") || "home";
  return ROUTES.has(route) ? route : "home";
}

export function renderRoute(route = routeFromHash()) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.hidden = screen.id !== route;
  });
  document.body.dataset.route = route;
}

window.addEventListener("hashchange", () => renderRoute());
renderRoute();
