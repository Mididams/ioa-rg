import { describe, it, expect, vi } from "vitest";
import { initialRuntime as applicationState } from "./rotation.ts";
import { initialRuntime, documentBody, initialize, modeFor, target } from "./scripts/initialize-runtime.mjs";

const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const metadata = { name: target, type: "FIRESTORE_NATIVE", databaseEdition: "STANDARD" };
function transport() {
  return vi.fn().mockResolvedValueOnce(response(200, metadata))
    .mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(200));
}
const run = (fetchImpl, mode = "apply") => initialize({ mode, token: "test-token", fetchImpl, log: () => {} });
describe("Preparation de runtime/current (reseau simule uniquement)", () => {
  it("correspond exactement au modele utilise par les transactions", () => {
    expect(initialRuntime).toEqual(applicationState);
    expect(Object.keys(documentBody.fields)).toHaveLength(14);
    expect(documentBody.fields.seq).toEqual({ integerValue: "0" });
  });
  it("ne fait aucun appel reseau par defaut", async () => {
    const fetchImpl = vi.fn(); await run(fetchImpl, "preview"); expect(fetchImpl).not.toHaveBeenCalled();
    expect(modeFor([])).toBe("preview");
    expect(() => modeFor(["--apply"])).toThrow();
    expect(() => modeFor(["--apply", "--confirm=other"])).toThrow();
  });
  it("verifie sans ecrire avec --check", async () => {
    const fetchImpl = transport(); await run(fetchImpl, "check");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.every(([, options]) => !options.method)).toBe(true);
  });
  it("refuse un document existant", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, metadata)).mockResolvedValueOnce(response(200));
    await expect(run(fetchImpl)).rejects.toThrow("already exists");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 500])("ne confond pas HTTP %i avec une base vide", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(response(status));
    await expect(run(fetchImpl)).rejects.toThrow("no write attempted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("refuse un historique existant", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, metadata))
      .mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(200, { documents: [{}] }));
    await expect(run(fetchImpl)).rejects.toThrow("history");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("cree une seule fois avec createDocument puis relit", async () => {
    const fetchImpl = transport().mockResolvedValueOnce(response(200)).mockResolvedValueOnce(response(200, {
      name: `${target}/documents/runtime/current`, ...documentBody,
    }));
    await run(fetchImpl);
    const writes = fetchImpl.mock.calls.filter(([, options]) => options.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe(`https://firestore.googleapis.com/v1/${target}/documents/runtime?documentId=current`);
    expect(writes[0][1].method).toBe("POST");
    expect(JSON.parse(writes[0][1].body)).toEqual(documentBody);
  });
  it("ne retente pas une creation concurrente", async () => {
    const fetchImpl = transport().mockResolvedValueOnce(response(409));
    await expect(run(fetchImpl)).rejects.toThrow("not overwritten");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it("ne retente pas une ecriture dont le resultat est incertain", async () => {
    const fetchImpl = transport().mockRejectedValueOnce(new Error("network"));
    await expect(run(fetchImpl)).rejects.toThrow("uncertain");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
