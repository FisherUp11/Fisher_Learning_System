import { buildImportTemplate } from "@/lib/csv-import";

export function GET() {
  return buildImportTemplate("poems");
}
