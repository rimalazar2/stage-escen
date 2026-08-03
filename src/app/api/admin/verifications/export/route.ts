import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * GET /api/admin/verifications/export
 * Export CSV de l'historique des vérifications (protégé, admin uniquement).
 */
export async function GET() {
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

    const verifTable = supabase.from("verifications");
    const { data: verifications, error } = await verifTable
      .select("*, releves!inner(student_name, student_id)")
      .order("timestamp", { ascending: false });

    if (error) {
      return NextResponse.json(
        { success: false, error: "Erreur lors de l'export." },
        { status: 500 }
      );
    }

    const rows = (verifications ?? []).map((v) => [
      new Date(v.timestamp).toLocaleString("fr-FR"),
      v.releve_id ?? "",
      v.releves?.student_name ?? "",
      v.releves?.student_id ?? "",
      v.result === "success" ? "Succès" : "Échec",
      v.error_type,
      v.ip_address,
      v.user_agent,
    ]);

    const csvContent = [
      ["Date", "Identifiant Relevé", "Étudiant", "ID Étudiant", "Résultat", "Type d'erreur", "IP (hashée)", "Navigateur"].join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    // Log l'export
    const adminLogs = supabase.from("admin_logs");
    await adminLogs.insert({
      admin_id: user.id,
      admin_email: user.email ?? "",
      action: "export",
      target_releve_id: null,
      details: { count: rows.length },
    });

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="verifications-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Erreur serveur." },
      { status: 500 }
    );
  }
}
