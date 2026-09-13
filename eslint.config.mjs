import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * La frontière lecture seule de Hermes.
 *
 * Un outil Hermes (src/hermes/tools/**) ne peut importer ni un module qui
 * écrit, ni les fonctions d'écriture des stores qu'il a le droit de lire. La
 * liste est explicite : un nouvel outil qui tente une mutation échoue au lint,
 * avant tout déploiement.
 */
const HERMES_FORBIDDEN_MODULES = [
  "@/lib/airtable/write",
  "@/lib/meta/write",
  "@/lib/meta/uploader",
  "@/lib/studio/kie",
  "@/lib/storage",
  "fs",
  "fs/promises",
  "node:fs",
  "node:fs/promises",
  "child_process",
  "node:child_process",
];

const HERMES_FORBIDDEN_NAMES = [
  { name: "@/lib/phoenix/client", importNames: ["createRefund"] },
  { name: "@/lib/phoenix/snapshot", importNames: ["startSync"] },
  { name: "@/lib/ecom-sites/store", importNames: ["createEcomSite", "updateEcomSite", "deleteEcomSite", "cloneEcomSite"] },
  { name: "@/lib/ecom-sites/messages", importNames: ["addMessage", "removeMessage"] },
  { name: "@/lib/ecom-sites/orders", importNames: ["createOrder"] },
  { name: "@/lib/bank-pages/store", importNames: ["createBankPage", "updateBankPage", "deleteBankPage"] },
  {
    name: "@/lib/creative-engine/store",
    importNames: ["analyzeAndSaveProduct", "updateProduct", "deleteProduct", "createTestBatch", "retryFailed", "regenerateItem", "duplicateItem", "refreshBatch", "setItemStatus", "deleteBatch", "exportToDrive"],
  },
  { name: "@/lib/metrics/spend-store", importNames: ["setSpend", "setSpendBulk"] },
  { name: "@/lib/meta/registry", importNames: ["addStoredToken", "removeStoredToken", "setAutoDetect", "rememberAccounts", "acknowledgeAccounts", "getExtraTokens"] },
  { name: "@/lib/drive/store", importNames: ["createFolder", "saveFile", "removeEntry", "renameEntry", "moveEntry"] },
  { name: "@/lib/spyshop/store", importNames: ["addProject", "removeProject", "addShop", "removeShop", "updateShop", "checkShop"] },
  { name: "@/lib/ugc/store", importNames: ["createBatch", "applyResults", "stitchAngle", "deleteBatch"] },
  { name: "@/lib/studio/library", importNames: ["saveStaticCreative", "deleteStaticCreative"] },
  { name: "@/lib/creative-library/store", importNames: ["saveStyle", "renameStyle", "deleteStyle", "saveScript", "updateScript", "deleteScript"] },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/hermes/tools/**/*.ts", "src/hermes/registry.ts", "src/hermes/run.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...HERMES_FORBIDDEN_MODULES.map((name) => ({ name, message: "Hermes est en lecture seule : ce module écrit." })),
            ...HERMES_FORBIDDEN_NAMES.map((entry) => ({ ...entry, message: "Hermes est en lecture seule : fonction d'écriture." })),
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
