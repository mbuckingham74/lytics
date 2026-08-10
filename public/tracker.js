(() => {
  "use strict";

  const cookieName = "lytics_visitor_id";
  const cookieLifetimeSeconds = 365 * 24 * 60 * 60;
  const visitorIdPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const script = document.currentScript;

  if (!script?.src) {
    return;
  }

  function readVisitorId() {
    for (const part of document.cookie.split(";")) {
      const cookie = part.trim();
      const separator = cookie.indexOf("=");

      if (separator >= 0 && cookie.slice(0, separator) === cookieName) {
        return cookie.slice(separator + 1);
      }
    }

    return null;
  }

  let visitorId = readVisitorId();

  if (!visitorId || !visitorIdPattern.test(visitorId)) {
    try {
      visitorId = globalThis.crypto.randomUUID().toLowerCase();
    } catch {
      return;
    }

    if (!visitorIdPattern.test(visitorId)) {
      return;
    }
  }

  const secureAttribute =
    globalThis.location.protocol === "https:" ? "; Secure" : "";

  try {
    document.cookie = `${cookieName}=${visitorId}; Max-Age=${cookieLifetimeSeconds}; Path=/; SameSite=Lax${secureAttribute}`;
  } catch {
    return;
  }

  if (readVisitorId() !== visitorId) {
    return;
  }

  const payload = {
    visitorId,
    path: globalThis.location.pathname,
  };
  const referrer = document.referrer.trim();

  if (referrer) {
    payload.referrer = referrer;
  }

  try {
    const request = globalThis.fetch(
      new URL("/api/pageviews", script.src).toString(),
      {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        keepalive: true,
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    request.catch(() => {});
  } catch {
    // Analytics must never interfere with the host page.
  }
})();
