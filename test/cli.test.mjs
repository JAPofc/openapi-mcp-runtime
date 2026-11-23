import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fixture = (name) => join(here, "fixtures", name);

function run(args) {
  return spawnSync(process.execPath, [join(root, "dist", "cli.js"), ...args], {
    encoding: "utf8",
    cwd: root,
  });
}

test("--print-tools outputs the tools as JSON", () => {
  const result = run(["--print-tools", fixture("petstore-3.0.json")]);
  assert.equal(result.status, 0, result.stderr);
  const tools = JSON.parse(result.stdout);
  assert.equal(tools.length, 3);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["getPetById", "deletePet", "createPet"],
  );
});

test("--version prints the package version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\d+\.\d+\.\d+/);
});

test("--help documents usage", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--transport/);
});

test("missing spec exits with an error", () => {
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing <spec>/);
});
