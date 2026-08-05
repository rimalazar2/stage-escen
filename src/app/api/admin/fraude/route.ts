import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * GET /api/admin/fraude
 * Liste les alertes anti-fraude (protégé, admin uniquement).
 * Chaque ligne = un identifiant qui a subi des tentatives répétées
 * (1 alerte max / identifiant / 24 h, déclenchée par la détection).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();

    // Vérifier l'authentification
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Non autorisé." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") ?? "50", 10)));
    const offset = (page - 1) * perPage;

    const { data, error, count } = await supabase
      .from("fraud_alerts")
      .select("*", { count: "exact" })
      .order("alerted_at", { ascending: false })
      .range(offset, offset + perPage - 1);

    if (error) {
      return NextResponse.json(
        { success: false, error: "Erreur lors de la récupération des alertes." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        per_page: perPage,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Erreur serveur." },
      { status: 500 }
    );
  }
}
