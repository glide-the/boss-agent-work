interface DisplayBridge {
  displayImage(image: Uint8Array): Promise<void>;
  displayValue(value: DisplayValue): Promise<void>;
}

type DisplayValue =
  | { type: "function"; value: undefined }
  | { type: "error" | "object"; value: string }
  | {
      type: "value";
      value: string | number | boolean | null | undefined;
    };

interface NodeReplDisplayGlobals {
  nodeRepl?: {
    emitImage?(image: Uint8Array): Promise<void> | void;
  };
  console?: {
    log?(value: DisplayValue): void;
  };
}

interface CreateDisplayOptions {
  displayBridge: DisplayBridge;
  displayTruncateMaxChars?: number;
}

function primitiveDisplayValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value instanceof String || value instanceof Boolean) return value.valueOf();
  if (value instanceof Number) {
    const number = value.valueOf();
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function truncate(value: string, maximumCharacters: number | undefined): string {
  if (!isPositiveInteger(maximumCharacters)) return value;
  if (value.length <= maximumCharacters) return value;
  const truncatedCharacters = value.length - maximumCharacters;
  return `${value.slice(0, maximumCharacters)}[truncated ${truncatedCharacters} chars]`;
}

function truncateDisplayValue(
  value: DisplayValue,
  maximumCharacters: number | undefined,
): DisplayValue {
  switch (value.type) {
    case "function":
      return value;
    case "error":
    case "object":
      return { ...value, value: truncate(value.value, maximumCharacters) };
    case "value":
      return typeof value.value !== "string"
        ? value
        : { ...value, value: truncate(value.value, maximumCharacters) };
  }
}

async function display(
  bridge: DisplayBridge,
  value: unknown,
  maximumCharacters: number | undefined,
): Promise<void> {
  let displayedValue: DisplayValue | null = null;
  try {
    if (value instanceof Uint8Array) {
      await bridge.displayImage(value);
      return;
    }
    if (value === undefined) displayedValue = { type: "value", value: undefined };
    else if (typeof value === "function")
      displayedValue = { type: "function", value: undefined };
    else {
      const primitive = primitiveDisplayValue(value);
      if (primitive !== undefined)
        displayedValue = { type: "value", value: primitive };
    }
    if (displayedValue === null) {
      let serialized = JSON.stringify(value);
      if (serialized === undefined) serialized = String(value);
      displayedValue = { type: "object", value: serialized };
    }
  } catch (error) {
    displayedValue = { type: "error", value: String(error) };
  }
  await bridge.displayValue(
    truncateDisplayValue(displayedValue, maximumCharacters),
  );
}

export function createDisplay({
  displayBridge,
  displayTruncateMaxChars,
}: CreateDisplayOptions): (value: unknown) => Promise<void> {
  return async (value) =>
    await display(displayBridge, value, displayTruncateMaxChars);
}

export function createNodeReplDisplayBridge(
  globals: NodeReplDisplayGlobals,
): DisplayBridge {
  return {
    displayImage: async (image) => {
      await globals.nodeRepl?.emitImage?.(image);
    },
    displayValue: async (value) => {
      const runtimeConsole = globals.console;
      if (runtimeConsole != null && typeof runtimeConsole.log === "function") {
        runtimeConsole.log(value);
        return;
      }
      console.log(value);
    },
  };
}
