import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  registerSiteAtBoundary,
  updateSiteAtBoundary,
} from "./site-registration";
import {
  findSiteByDomain,
  initializeSites,
  listSites,
  registerSite,
} from "./sites";

function withDatabase(run: (database: DatabaseSync) => void): void {
  const database = new DatabaseSync(":memory:");

  try {
    initializeSites(database);
    run(database);
  } finally {
    database.close();
  }
}

const invalidHostnameMessage =
  "Enter a valid hostname, such as example.com, without a protocol, credentials, port, path, query, or fragment.";

test("registers a normalized site through the settings boundary", () => {
  withDatabase((database) => {
    const result = registerSiteAtBoundary(database, {
      name: "  Personal Site  ",
      domain: "  PERSONAL.Example  ",
    });

    assert.deepEqual(result, {
      ok: true,
      site: { id: 1, name: "Personal Site", domain: "personal.example" },
    });
    assert.deepEqual(listSites(database), [
      { id: 1, name: "Personal Site", domain: "personal.example" },
    ]);
  });
});

test("canonicalizes Unicode IDNs to lowercase ASCII", () => {
  withDatabase((database) => {
    const result = registerSiteAtBoundary(database, {
      name: "  Bücher  ",
      domain: "  BÜCHER.Example  ",
    });

    assert.deepEqual(result, {
      ok: true,
      site: { id: 1, name: "Bücher", domain: "xn--bcher-kva.example" },
    });
    assert.deepEqual(listSites(database), [
      { id: 1, name: "Bücher", domain: "xn--bcher-kva.example" },
    ]);
  });
});

test("accepts hostname label boundaries through the 253-byte maximum", () => {
  withDatabase((database) => {
    const maximumHostname = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;

    const result = registerSiteAtBoundary(database, {
      name: "Maximum hostname",
      domain: maximumHostname,
    });

    assert.equal(maximumHostname.length, 253);
    assert.deepEqual(result, {
      ok: true,
      site: { id: 1, name: "Maximum hostname", domain: maximumHostname },
    });
  });
});

test("returns stable messages for blank settings fields without persisting", () => {
  withDatabase((database) => {
    assert.deepEqual(
      registerSiteAtBoundary(database, { name: "  ", domain: "site.example" }),
      { ok: false, message: "Enter a site name." },
    );
    assert.deepEqual(
      registerSiteAtBoundary(database, { name: "Site", domain: "  " }),
      { ok: false, message: invalidHostnameMessage },
    );
    assert.deepEqual(
      registerSiteAtBoundary(database, { name: null, domain: "site.example" }),
      { ok: false, message: "Enter a site name." },
    );
    assert.deepEqual(listSites(database), []);
  });
});

test("rejects non-hostname domain inputs with one message and no persistence", () => {
  const invalidDomains: unknown[] = [
    null,
    42,
    "",
    "   ",
    "https://example.com",
    "user:password@example.com",
    "example.com:443",
    "example.com/path",
    "example.com?query=value",
    "example.com#fragment",
    "192.0.2.1",
    "127.1",
    "2001:db8::1",
    "[2001:db8::1]",
    "localhost",
    "intranet",
    "例子",
    "*.example.com",
    "_service._tcp.example.com",
    ".example.com",
    "example..com",
    "example.com.",
    "-leading.example",
    "trailing-.example",
    "bad label.example",
    "bad+label.example",
    `${"a".repeat(64)}.example`,
    `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
  ];

  withDatabase((database) => {
    for (const domain of invalidDomains) {
      assert.deepEqual(
        registerSiteAtBoundary(database, { name: "Invalid", domain }),
        { ok: false, message: invalidHostnameMessage },
        `expected ${String(domain)} to be rejected`,
      );
      assert.deepEqual(listSites(database), []);
    }
  });
});

test("rejects a case-insensitive duplicate domain without exposing SQLite errors", () => {
  withDatabase((database) => {
    registerSite(database, { name: "First", domain: "personal.example" });

    assert.deepEqual(
      registerSiteAtBoundary(database, {
        name: "Duplicate",
        domain: "PERSONAL.EXAMPLE",
      }),
      { ok: false, message: "That domain is already registered." },
    );
    assert.deepEqual(listSites(database), [
      { id: 1, name: "First", domain: "personal.example" },
    ]);
  });
});

test("treats Unicode and punycode equivalents as duplicate hostnames", () => {
  withDatabase((database) => {
    assert.equal(
      registerSiteAtBoundary(database, {
        name: "Punycode",
        domain: "xn--bcher-kva.example",
      }).ok,
      true,
    );

    assert.deepEqual(
      registerSiteAtBoundary(database, {
        name: "Unicode duplicate",
        domain: "BÜCHER.example",
      }),
      { ok: false, message: "That domain is already registered." },
    );
    assert.deepEqual(listSites(database), [
      { id: 1, name: "Punycode", domain: "xn--bcher-kva.example" },
    ]);
  });
});

test("contains unexpected persistence failures behind a safe message", () => {
  const database = new DatabaseSync(":memory:");

  try {
    assert.deepEqual(
      registerSiteAtBoundary(database, { name: "Site", domain: "site.example" }),
      { ok: false, message: "Could not register the site. Try again." },
    );
  } finally {
    database.close();
  }
});

test("updates an existing site with a stable ID and canonical domain", () => {
  withDatabase((database) => {
    const site = registerSite(database, {
      name: "Original",
      domain: "original.example",
    });

    const result = updateSiteAtBoundary(database, {
      siteId: site.id,
      name: "  Renamed Site  ",
      domain: "  BÜCHER.Example  ",
    });

    assert.deepEqual(result, {
      ok: true,
      site: {
        id: site.id,
        name: "Renamed Site",
        domain: "xn--bcher-kva.example",
      },
    });
    assert.equal(findSiteByDomain(database, "original.example"), null);
    assert.deepEqual(
      findSiteByDomain(database, "XN--BCHER-KVA.EXAMPLE"),
      result.ok ? result.site : null,
    );
  });
});

test("allows no-op and canonically equivalent self-domain updates", () => {
  withDatabase((database) => {
    const site = registerSite(database, {
      name: "Books",
      domain: "xn--bcher-kva.example",
    });

    assert.deepEqual(
      updateSiteAtBoundary(database, {
        siteId: site.id,
        name: site.name,
        domain: "BÜCHER.Example",
      }),
      { ok: true, site },
    );
    assert.deepEqual(listSites(database), [site]);
  });
});

test("rejects invalid and unknown update site IDs without mutation", () => {
  withDatabase((database) => {
    const site = registerSite(database, {
      name: "Existing",
      domain: "existing.example",
    });

    for (const siteId of [null, "1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.deepEqual(
        updateSiteAtBoundary(database, {
          siteId,
          name: "Changed",
          domain: "changed.example",
        }),
        { ok: false, message: "Select a valid site." },
      );
    }
    assert.deepEqual(
      updateSiteAtBoundary(database, {
        siteId: 999,
        name: "Missing",
        domain: "missing.example",
      }),
      { ok: false, message: "That site is not registered." },
    );
    assert.deepEqual(listSites(database), [site]);
  });
});

test("rejects blank names and invalid hostnames during updates", () => {
  withDatabase((database) => {
    const site = registerSite(database, {
      name: "Existing",
      domain: "existing.example",
    });

    assert.deepEqual(
      updateSiteAtBoundary(database, {
        siteId: site.id,
        name: "   ",
        domain: "changed.example",
      }),
      { ok: false, message: "Enter a site name." },
    );
    assert.deepEqual(
      updateSiteAtBoundary(database, {
        siteId: site.id,
        name: "Changed",
        domain: "https://changed.example/path",
      }),
      { ok: false, message: invalidHostnameMessage },
    );
    assert.deepEqual(listSites(database), [site]);
  });
});

test("rejects another site's canonical domain atomically", () => {
  withDatabase((database) => {
    const first = registerSite(database, {
      name: "First",
      domain: "first.example",
    });
    const second = registerSite(database, {
      name: "Books",
      domain: "xn--bcher-kva.example",
    });
    const sitesBefore = listSites(database);

    for (const domain of ["XN--BCHER-KVA.EXAMPLE", "BÜCHER.example"]) {
      assert.deepEqual(
        updateSiteAtBoundary(database, {
          siteId: first.id,
          name: "Should Not Persist",
          domain,
        }),
        { ok: false, message: "That domain is already registered." },
      );
      assert.deepEqual(listSites(database), sitesBefore);
    }
    assert.deepEqual(findSiteByDomain(database, second.domain), second);
  });
});

test("contains unexpected update failures behind an update-specific message", () => {
  const database = new DatabaseSync(":memory:");

  try {
    assert.deepEqual(
      updateSiteAtBoundary(database, {
        siteId: 1,
        name: "Changed",
        domain: "changed.example",
      }),
      { ok: false, message: "Could not update the site. Try again." },
    );
  } finally {
    database.close();
  }
});
