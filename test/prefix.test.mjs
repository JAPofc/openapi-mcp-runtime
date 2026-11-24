import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, createRuntime, applyToolPrefix } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, "fixtures", name);

test("applyToolPrefix namespaces every tool name", async () => {
  const runtime = createRuntime(await loadSpec(fixture("petstore-3.0.json")));
  applyToolPrefix(runtime.tools, "petstore");

  assert.deepEqual(
    runtime.tools.map((tool) => tool.name),
    ["petstore_getPetById", "petstore_deletePet", "petstore_createPet"],
  );
});

test("applyToolPrefix keeps names unique and ignores empty prefixes", async () => {
  const runtime = createRuntime(await loadSpec(fixture("petstore-3.0.json")));
  applyToolPrefix(runtime.tools, "");
  assert.equal(runtime.tools[0].name, "getPetById");

  applyToolPrefix(runtime.tools, "---");
  assert.equal(runtime.tools[0].name, "getPetById");
});
