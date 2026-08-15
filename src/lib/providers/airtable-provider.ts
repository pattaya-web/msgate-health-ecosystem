import type { IDataProvider } from "@/lib/providers/types";
import { MockDataProvider } from "@/lib/providers/mock-provider";

/**
 * Airtable-backed provider.
 * Currently delegates to mock until AIRTABLE_* env vars are fully configured.
 * Swap method implementations to use lib/airtable/* when ready.
 */
export class AirtableDataProvider extends MockDataProvider implements IDataProvider {
  constructor() {
    super();
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
      console.warn(
        "[AirtableDataProvider] Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID — falling back to mock data."
      );
    }
  }
}
