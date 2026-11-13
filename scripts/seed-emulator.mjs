// Local emulator only: never accepts a production URL or project.
const endpoint = "http://127.0.0.1:8080/v1/projects/demo-ioa-rang/databases/(default)/documents/runtime/current";
const fields = Object.fromEntries([
  ["seq", { integerValue: "0" }], ["lastRequestId", { stringValue: "initial" }],
  ...["lastKind", "lastHub", "lastAt", "globalResetAt", "hub1LastSeq", "hub1LastAt", "hub1ResetAt", "hub2LastSeq", "hub2LastAt", "hub2ResetAt"].map((key) => [key, { nullValue: null }]),
  ["hub1Count", { integerValue: "0" }], ["hub2Count", { integerValue: "0" }],
]);
const response = await fetch(endpoint + "?currentDocument.exists=false", {
  method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
  body: JSON.stringify({ fields }),
});
if (!response.ok) throw new Error(`Emulator initialization refused (${response.status}): ${await response.text()}`);
console.log("Created demo-ioa-rang/runtime/current locally. Existing data is never overwritten.");
