import { buildImportTemplate } from "@/lib/csv-import";

export async function GET() { return buildImportTemplate("adult_video"); }
