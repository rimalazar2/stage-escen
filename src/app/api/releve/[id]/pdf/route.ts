import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRelevePDF } from "@/lib/pdf";
import { resolveActiveReleve } from "@/lib/releves";

/**
 * GET /api/releve/[id]/pdf
 * Génère le PDF officiel du relevé de notes (avec QR Code intégré).
 * Accessible publiquement pour un relevé actif (RLS), sans session.
 * Nom du fichier basé sur le n° étudiant pour un audit facile.
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

    // Résolution via la chaîne de remplacement : le PDF servi pour une
    // ancienne version est celui de la version officielle à jour (le QR code
    // imprimé reste valide). Relevé annulé / chaîne cassée → not_found.
    const releve = await resolveActiveReleve(supabase, id);

    if (!releve) {
      return NextResponse.json(
        { success: false, error: { code: "not_found", message: "" } },
        { status: 404 }
      );
    }

    const pdfBuffer = await generateRelevePDF(releve);
    const safeId = (releve.student_id || "releve").replace(/[^a-zA-Z0-9_-]/g, "");

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="releve-${safeId}.pdf"`,
        // Pas de cache longue durée : si le relevé est remplacé, l'ID d'une
        // ancienne version sert désormais le PDF de la version à jour — un
        // cache périmé afficherait un document obsolète.
        "Cache-Control": "public, no-cache",
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "server_error", message: "" } },
      { status: 500 }
    );
  }
}
