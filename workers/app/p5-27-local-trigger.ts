interface TriggerBindings {
  TARGET: Fetcher;
}

export default {
  async fetch(request, bindings) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health") {
      return bindings.TARGET.fetch("https://biblequiz-app-preview.jinkyu0105.workers.dev/api/health");
    }
    if (request.method === "POST" && (path === "/leaf" || path === "/ready")) {
      return bindings.TARGET.fetch(`https://p5-27.invalid/__p5-27${path}${url.search}`, {
        method: "POST",
        headers: {
          "x-p5-27-internal": "p5-27-service-binding-only",
          "content-type": "application/json",
        },
        body: await request.text(),
      });
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<TriggerBindings>;
