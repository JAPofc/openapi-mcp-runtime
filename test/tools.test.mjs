import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, specLabel, createRuntime, publicTool } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, "fixtures", name);

test("loads OpenAPI 3.0 JSON and converts operations to tools", async () => {
  const spec = await loadSpec(fixture("petstore-3.0.json"));
  assert.equal(specLabel(spec), "OpenAPI 3.0.3");

  const runtime = createRuntime(spec, { baseUrl: "http://example.test" });
  assert.equal(runtime.tools.length, 3);

  const names = runtime.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["getPetById", "deletePet", "createPet"]);

  const getPet = runtime.tools.find((tool) => tool.name === "getPetById");
  assert.equal(getPet.method, "GET");
  assert.equal(getPet.path, "/pets/{petId}");
  assert.ok(getPet.inputSchema.properties.petId, "path param exposed");
  assert.ok(getPet.inputSchema.properties.verbose, "query param exposed");
  assert.deepEqual(getPet.inputSchema.required, ["petId"]);
  assert.equal(getPet.annotations.readOnlyHint, true);

  const createPet = runtime.tools.find((tool) => tool.name === "createPet");
  assert.ok(createPet.inputSchema.properties.name, "body property merged");
  assert.deepEqual(createPet.inputSchema.required, ["name"]);
});

test("loads OpenAPI 3.1 YAML with oauth2 security", async () => {
  const spec = await loadSpec(fixture("petstore-3.1.yaml"));
  assert.equal(specLabel(spec), "OpenAPI 3.1.0");

  const runtime = createRuntime(spec);
  assert.equal(runtime.tools.length, 1);
  const tool = runtime.tools[0];
  assert.equal(tool.name, "getStatus");
  assert.equal(tool.security.length, 1);
  assert.ok(tool.security[0].oauth2, "operation security preserved");
  assert.ok(runtime.securitySchemes.oauth2, "security schemes resolved");
});

test("loads Swagger 2.0 with query apiKey and body param", async () => {
  const spec = await loadSpec(fixture("swagger-2.0.json"));
  const runtime = createRuntime(spec);
  assert.equal(runtime.tools.length, 2);
  assert.equal(runtime.baseUrl, "http://127.0.0.1:4010/v1");

  const getUser = runtime.tools.find((tool) => tool.name === "getUser");
  assert.ok(getUser.inputSchema.properties.fields, "swagger query param exposed");

  const createUser = runtime.tools.find((tool) => tool.name === "createUser");
  assert.ok(createUser.inputSchema.properties.email, "swagger body schema merged");
});

test("publicTool hides internal fields", async () => {
  const spec = await loadSpec(fixture("petstore-3.0.json"));
  const runtime = createRuntime(spec);
  const projected = publicTool(runtime.tools[0]);
  assert.deepEqual(Object.keys(projected).sort(), ["annotations", "description", "inputSchema", "name"]);
});
