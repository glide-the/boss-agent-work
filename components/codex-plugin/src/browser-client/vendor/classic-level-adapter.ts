import { createRequire } from "node:module";

interface ClassicLevelCommonJsModule {
  ClassicLevel: typeof import("classic-level").ClassicLevel;
}

const require = createRequire(import.meta.url);
const classicLevelModule = require(
  "./classic-level/index.js",
) as ClassicLevelCommonJsModule;

export const ClassicLevel = classicLevelModule.ClassicLevel;
