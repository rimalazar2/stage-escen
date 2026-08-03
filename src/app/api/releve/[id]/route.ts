import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveReleve } from "@/lib/releves";

/**
 * GET /api/releve/[id]
 * Récupère un relevé de notes par son identifiant unique.
 * Accessible publiquement (uniquement si actif).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || id.length < 8) {
      return NextResponse.json(
        { success: false, error: { code: "not_found", message: "" } },
        { status: 404 }
      );
    }

    const supabase = await createClient();

    // Résolution via la chaîne de remplacement : le QR code d'une ancienne
    // version affiche la version officielle à jour. Un relevé annulé ou une
    // chaîne cassée → not_found (anti-fraude : indistinguable d'un ID inconnu).
    const releve = await resolveActiveReleve(supabase, id);

    if (!releve) {
      return NextResponse.json(
        { success: false, error: { code: "not_found", message: "" } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { releve } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "server_error", message: "" } },
      { status: 500 }
    );
  }
}
