import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * GET /api/admin/verifications
 * Liste l'historique des vérifications (protégé, admin uniquement).
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
    const dateFrom = searchParams.get("from");
    const dateTo = searchParams.get("to");
    const resultFilter = searchParams.get("result");
    const errorTypeFilter = searchParams.get("error_type");
    const searchQuery = searchParams.get("q")?.trim() || "";
    const hasSignals = searchParams.get("signals") === "yes";

    const verifTable = supabase.from("verifications");

    // NB: left join (releves) — une vérification peut ne référencer aucun
    // relevé (échec sur identifiant inconnu).
    let dbQuery = verifTable
      .select("*, releves(student_name, student_id)", { count: "exact" });

    if (resultFilter === "success" || resultFilter === "failed") {
      dbQuery = dbQuery.eq("result", resultFilter);
    }

    if (errorTypeFilter) {
      dbQuery = dbQuery.eq("error_type", errorTypeFilter);
    }

    if (hasSignals) {
      // Non-vide : le tableau `signals` contient au moins un élément.
      // NB: on passe la syntaxe brute `neq.{}` — supabase-js encoderait un
      // tableau JS vide en `[]`, literal PostgreSQL invalide pour text[]
      // (erreur 22P02).
      dbQuery = dbQuery.filter("signals", "neq", "{}");
    }

    if (searchQuery) {
      // Recherche sur l'identifiant tenté OU sur l'ID de la vérification via
      // la colonne générée id_text (ilike possible) — la référence affichée
      // dans le filigrane anti-capture (8 premiers caractères) est retrouvable.
      dbQuery = dbQuery.or(
        `attempted_id.ilike.%${searchQuery}%,id_text.ilike.%${searchQuery}%`
      );
    }

    if (dateFrom) {
      dbQuery = dbQuery.gte("timestamp", dateFrom);
    }
    if (dateTo) {
      dbQuery = dbQuery.lte("timestamp", dateTo);
    }

    const { data, error, count } = await dbQuery
      .order("timestamp", { ascending: false })
      .range(offset, offset + perPage - 1);

    if (error) {
      return NextResponse.json(
        { success: false, error: "Erreur lors de la récupération des logs." },
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
