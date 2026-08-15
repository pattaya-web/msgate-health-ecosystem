import { mockProvider } from "@/lib/providers/mock-provider";
import type { IDataProvider } from "@/lib/providers/types";
import { AirtableDataProvider } from "@/lib/providers/airtable-provider";

export function getDataProvider(): IDataProvider {
  const mode = process.env.DATA_PROVIDER ?? "mock";
  if (mode === "airtable") {
    return new AirtableDataProvider();
  }
  return mockProvider;
}

export { mockProvider };
export type { IDataProvider };
