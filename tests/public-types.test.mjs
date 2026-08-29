import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const surfaces = new Map([
  [
    "packages/core/dist/index.d.ts",
    [
      "Capture",
      "CaptureConfig",
      "CaptureDelivery",
      "CaptureDeliveryReason",
      "CaptureEventType",
      "CapturePageResult",
      "BrowserCollectionPosture",
      "CollectionMode",
      "CollectionPostureObservation",
      "CollectionPostureRuntimeConfig",
      "Scope",
      "VisitorChoice",
      "WriteResult",
      "createCapture",
    ],
  ],
  [
    "packages/core/dist/server.d.ts",
    [
      "Client",
      "ClientConfig",
      "CollectBody",
      "CollectEventType",
      "CollectionPostureRuntimeConfig",
      "Environment",
      "Evidence",
      "FonteApiError",
      "JourneyIdentityScope",
      "ParseOptions",
      "SourceTouchClassification",
      "TouchInput",
      "TouchPayload",
      "WriteResult",
      "collect",
      "createClient",
    ],
  ],
  [
    "packages/core/dist/installation-verification.d.ts",
    [
      "FONTE_CONFIG_VERSION",
      "INSTALLATION_VERIFICATION_SCHEMA_VERSION",
      "INSTALLATION_VERIFICATION_SDK_VERSION",
      "InstallationVerificationMetadata",
      "normalizeInstallationAttemptId",
      "normalizeInstallationVerification",
    ],
  ],
  [
    "packages/react/dist/index.d.ts",
    ["Capture", "FonteProvider", "FonteProviderProps", "useFonte"],
  ],
  [
    "packages/nextjs/dist/index.d.ts",
    ["Capture", "FonteProvider", "FonteProviderProps", "useFonte"],
  ],
  [
    "packages/nextjs/dist/server.d.ts",
    [
      "CollectBody",
      "CollectEventType",
      "Evidence",
      "JourneyIdentityScope",
      "ParseOptions",
      "SourceTouchClassification",
      "TouchPayload",
      "collect",
    ],
  ],
  [
    "packages/nextjs/dist/installation-verification.d.ts",
    [
      "FONTE_CONFIG_VERSION",
      "INSTALLATION_VERIFICATION_ADAPTER_ID",
      "INSTALLATION_VERIFICATION_ADAPTER_VERSION",
      "INSTALLATION_VERIFICATION_SCHEMA_VERSION",
      "INSTALLATION_VERIFICATION_SDK_VERSION",
      "InstallationVerificationConfig",
      "InstallationVerificationMetadata",
      "normalizeInstallationAttemptId",
      "normalizeInstallationVerification",
      "normalizeInstallationVerificationConfig",
    ],
  ],
]);

test("declaration exports match the reviewed public API", () => {
  const entrypoints = [...surfaces.keys()].map((file) => path.join(root, file));
  const program = ts.createProgram(entrypoints, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  for (const [relativePath, expected] of surfaces) {
    const source = program.getSourceFile(path.join(root, relativePath));
    assert.ok(source, `missing declaration entrypoint ${relativePath}`);
    const symbol = checker.getSymbolAtLocation(source);
    assert.ok(symbol, `missing module symbol ${relativePath}`);
    assert.deepEqual(
      checker
        .getExportsOfModule(symbol)
        .map(({ name }) => name)
        .sort(),
      expected.toSorted(),
      relativePath,
    );
  }
});
