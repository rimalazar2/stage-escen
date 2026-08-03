import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateQRCodeBuffer } from "@/lib/qr";
import { resolveActiveReleve } from "@/lib/releves";

/**
 * GET /api/releve/[id]/qrcode
 * Retourne le QR Code (PNG) pointant vers /verify/[id].
 * Le QR Code encode uniquement le lien de vérification publique —
 * il ne contient aucune donnée personnelle.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || id.length < 8) {
      return new NextResponse("Not found", { status: 404 });
    }

    // Le QR code encode /verify/[id] — il ne change JAMAIS, même si le
    // relevé est remplacé ou corrigé (pas de réimpression). On vérifie
    // simplement que l'identifiant résout vers une version active ;
    // un relevé annulé renvoie 404 (anti-fraude).
    const supabase = await createClient();
    const releve = await resolveActiveReleve(supabase, id);

    if (!releve) {
      return new NextResponse("Not found", { status: 404 });
    }

    const buffer = await generateQRCodeBuffer(id);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="qrcode-${id}.png"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Erreur serveur." },
      { status: 500 }
    );
  }
}
