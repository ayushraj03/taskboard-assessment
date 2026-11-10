import { createAirtableTarget, getAirtableConfig } from "./airtable-target";
import type { ExportTarget } from "./types";

/** The configured Airtable target, or null if credentials are missing. */
export function getExportTarget(): ExportTarget | null {
  const config = getAirtableConfig();
  return config ? createAirtableTarget(config) : null;
}

/** Link to the Airtable base, for the UI. Base ids are not secret. */
export function getExportDestinationUrl(): string | null {
  const config = getAirtableConfig();
  return config ? `https://airtable.com/${config.baseId}` : null;
}
