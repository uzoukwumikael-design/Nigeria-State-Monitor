import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
const target = resolve("public/maplibre/maplibre-gl-worker.mjs");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`maplibre worker copied to ${target}`);
