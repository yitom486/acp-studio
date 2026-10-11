import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvidersModal } from "@/components/universal/ProvidersModal";
import { GitChangesModal } from "@/components/universal/GitChangesModal";
import { useWorkspaceDefaultQuery } from "@/lib/acp-queries";

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    const json = (data: any) => ({ ok: true, json: async () => data });
    if (u.includes("/providers/list")) {
      return json({
        ok: true,
        result: {
          providers: [
            { providerId: "openai", supported: ["openai"], required: true, current: { apiType: "openai", baseUrl: "", headers: {} } },
          ],
        },
      });
    }
    if (u === "/api/universal/workspace/default") return json({ ok: true, path: "/repo", name: "repo" });
    if (u.includes("/git/status")) {
      return json({ ok: true, repo: "/repo", branch: "main", files: [{ path: "a.ts", status: "M", staged: false }] });
    }
    if (u.includes("/git/file")) {
      return json({
        ok: true,
        repo: "/repo",
        file: "a.ts",
        binary: false,
        before: "const x = 1;",
        after: "const x = 2;",
        unified: "@@ -1 +1 @@\n-const x = 1;\n+const x = 2;",
      });
    }
    throw new Error("unexpected fetch: " + u);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderWithClient(node: React.ReactElement) {
  const qc = makeClient();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(h(QueryClientProvider, { client: qc }, node));
    await new Promise((r) => setTimeout(r, 100));
  });
  // Flush trailing query state updates.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return { el, root, qc };
}

describe("server state via TanStack Query", () => {
  it("providers modal lists rows from the query", async () => {
    const { el, root } = await renderWithClient(
      h(ProvidersModal, { isOpen: true, onClose: () => {}, agentId: "codex" })
    );
    expect(el.innerHTML).toContain("openai");
    expect(el.innerHTML).toContain("apiType");
    root.unmount();
    el.remove();
  });

  it("workspace default query resolves gateway default", async () => {
    const Probe = () => {
      const q = useWorkspaceDefaultQuery();
      return h("div", null, q.data ? `WS:${q.data.path}` : "pending");
    };
    const { el, root } = await renderWithClient(h(Probe));
    expect(el.innerHTML).toContain("WS:/repo");
    root.unmount();
    el.remove();
  });

  it("git modal lists status rows and selects the first file", async () => {
    const { el, root } = await renderWithClient(
      h(GitChangesModal, { isOpen: true, onClose: () => {}, cwd: "/repo" })
    );
    expect(el.innerHTML).toContain("a.ts");
    expect(el.innerHTML).toContain("main");
    root.unmount();
    el.remove();
  });
});
