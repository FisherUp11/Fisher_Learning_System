import { buildImportTemplate } from "@/lib/csv-import";

export async function GET() { return buildImportTemplate("family_maxims"); }
